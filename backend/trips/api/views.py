import json
import logging
import time
import zlib
from collections.abc import Iterator
from itertools import chain
from typing import Any

from django.conf import settings
from django.http import HttpRequest, JsonResponse, StreamingHttpResponse
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    PolymorphicProxySerializer,
    extend_schema,
)
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from trips.api import present
from trips.api.errors import internal_error_body, plan_error_body
from trips.api.serializers import (
    ErrorEventSerializer,
    ErrorSerializer,
    GeocodeQuerySerializer,
    GeocodeResponseSerializer,
    HealthSerializer,
    MetaEventSerializer,
    PlanRequestSerializer,
    PlanSerializer,
    ProgressEventSerializer,
    ResultEventSerializer,
    RoutesEventSerializer,
)
from trips.api.throttles import GeocodeThrottle, PlanThrottle
from trips.services.errors import PlanError
from trips.services.geocode import geocode
from trips.services.planner import PlanEvent, ResultEvent
from trips.services.providers import build_place_search, build_planner

log = logging.getLogger(__name__)

NDJSON = "application/x-ndjson"


class NDJSONRenderer(BaseRenderer):
    """Lets content negotiation accept ``application/x-ndjson``; the view streams the body."""

    media_type = NDJSON
    format = "ndjson"
    charset = None

    def render(
        self,
        data: Any,
        accepted_media_type: str | None = None,
        renderer_context: Any = None,
    ) -> bytes:
        return (json.dumps(data, separators=(",", ":")) + "\n").encode()


def _gzip_sync_flushed(chunks: Iterator[bytes]) -> Iterator[bytes]:
    """Gzip a byte stream, flushing after every chunk so each line reaches the client now.

    Django's GZipMiddleware buffers streaming bodies inside zlib (verified: five lines sent
    300 ms apart all arrived together), which would defeat progressive rendering.
    """
    compressor = zlib.compressobj(level=6, wbits=31)  # wbits=31 -> gzip container
    for chunk in chunks:
        yield compressor.compress(chunk) + compressor.flush(zlib.Z_SYNC_FLUSH)
    yield compressor.flush()


def ndjson_response(
    request: HttpRequest, events: Iterator[dict[str, object]]
) -> StreamingHttpResponse:
    """Stream one JSON object per line, each delivered as soon as it is produced.

    `X-Accel-Buffering: no` asks reverse proxies (Render, nginx) not to buffer the body.
    Setting Content-Encoding ourselves makes GZipMiddleware leave the response alone.
    """
    lines = ((json.dumps(event, separators=(",", ":")) + "\n").encode() for event in events)
    accepts_gzip = "gzip" in request.headers.get("Accept-Encoding", "")
    body = _gzip_sync_flushed(lines) if accepts_gzip else lines
    response = StreamingHttpResponse(body, content_type=NDJSON)
    if accepts_gzip:
        response["Content-Encoding"] = "gzip"
    response["Vary"] = "Accept-Encoding"
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


class HealthView(APIView):
    """Liveness probe. Makes no upstream calls, so keep-warm pings cost no quota."""

    @extend_schema(responses=HealthSerializer, operation_id="healthz")
    def get(self, request: Request) -> Response:
        return Response({"status": "ok", "version": settings.GIT_SHA})


class StreamProbeView(APIView):
    """Emits 5 NDJSON ticks 300 ms apart.

    Used to check that streaming survives gunicorn, gzip and the hosting proxy unbuffered.
    """

    TICKS = 5
    INTERVAL_S = 0.3

    @extend_schema(
        operation_id="healthz_stream",
        responses={(200, NDJSON): OpenApiResponse(description="NDJSON ticks")},
    )
    def get(self, request: Request) -> StreamingHttpResponse:
        def ticks() -> Iterator[dict[str, object]]:
            start = time.monotonic()
            for i in range(self.TICKS):
                if i:
                    time.sleep(self.INTERVAL_S)
                yield {"type": "tick", "i": i, "t_ms": round((time.monotonic() - start) * 1000)}

        return ndjson_response(request, ticks())


ERROR_CODES_BY_STATUS = {
    400: "VALIDATION",
    422: "NO_ROUTE",
    429: "RATE_LIMITED",
    500: "INTERNAL",
    502: "UPSTREAM_UNAVAILABLE",
    503: "UPSTREAM_RATE_LIMITED",
    504: "UPSTREAM_TIMEOUT",
}


def error_responses(*statuses: int) -> dict[int | tuple[int, str], Any]:
    """Error bodies are always JSON, also for NDJSON requests that fail before streaming."""
    return {
        (status, "application/json"): OpenApiResponse(
            ErrorSerializer, description=ERROR_CODES_BY_STATUS[status]
        )
        for status in statuses
    }


PLAN_EVENT = PolymorphicProxySerializer(
    component_name="PlanStreamEvent",
    serializers={
        "meta": MetaEventSerializer,
        "routes": RoutesEventSerializer,
        "progress": ProgressEventSerializer,
        "result": ResultEventSerializer,
        "error": ErrorEventSerializer,
    },
    resource_type_field_name="type",
)

DEMO_REQUEST = {
    "origin": {"label": "Denver, CO, USA", "lat": 39.7392, "lon": -104.9903},
    "destination": {"label": "Salt Lake City, UT, USA", "lat": 40.7608, "lon": -111.891},
    "departure_local": "2026-11-15T06:00",
    "load_weight_lb": 45000,
    "apply_hos": False,
}


def _stream_lines(events: Iterator[PlanEvent]) -> Iterator[dict[str, object]]:
    """Events as dicts; a failure after the stream has started becomes an ``error`` event."""
    try:
        for event in events:
            yield present.event_dict(event)
    except PlanError as exc:
        log.warning("plan stream failed: %s", exc.code)
        yield {"type": "error", **plan_error_body(exc)}
    except Exception:
        log.exception("plan stream crashed")
        yield {"type": "error", **internal_error_body()}


class PlanView(APIView):
    """Plan a truck trip: 3 routes, weather risk at each checkpoint's ETA, a recommendation.

    With `Accept: application/x-ndjson` the response is a stream of events, one JSON object
    per line: `meta`, `routes`, `progress`..., then `result` (or `error`). With
    `Accept: application/json` it is the final plan only.
    """

    renderer_classes = (JSONRenderer, NDJSONRenderer)
    throttle_classes = (PlanThrottle,)

    @extend_schema(
        operation_id="plan",
        request=PlanRequestSerializer,
        parameters=[
            OpenApiParameter(
                "X-Fixture",
                str,
                OpenApiParameter.HEADER,
                required=False,
                description="Fixture scenario; used only when PLAN_FIXTURES=1.",
                enum=["default", "two_routes", "no_travel_all", "upstream_429", "no_route"],
            )
        ],
        responses={
            (200, "application/json"): PlanSerializer,
            (200, NDJSON): OpenApiResponse(
                PLAN_EVENT, description="One PlanStreamEvent per line, in stream order."
            ),
            **error_responses(400, 422, 429, 500, 502, 503, 504),
        },
        examples=[
            OpenApiExample("Denver to Salt Lake City", value=DEMO_REQUEST, request_only=True)
        ],
    )
    def post(self, request: Request) -> JsonResponse | StreamingHttpResponse:
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        planner = build_planner(request.headers.get("X-Fixture"))
        events = planner.stream(serializer.to_plan_request())
        if request.accepted_renderer.media_type == NDJSON:
            # Routing runs before the first event, so routing errors still get a real status.
            first = next(events)
            return ndjson_response(request._request, _stream_lines(chain([first], events)))
        plan = next(e.plan for e in events if isinstance(e, ResultEvent))
        response = JsonResponse(present.plan_dict(plan))
        response["Server-Timing"] = planner.timings.header()
        return response


class GeocodeView(APIView):
    """Place search for the trip form (US, Canada, Mexico). Zero matches is 200 with []."""

    throttle_classes = (GeocodeThrottle,)

    @extend_schema(
        operation_id="geocode",
        parameters=[GeocodeQuerySerializer],
        responses={
            (200, "application/json"): GeocodeResponseSerializer,
            **error_responses(400, 429, 500, 502, 503, 504),
        },
    )
    def get(self, request: Request) -> Response:
        query = GeocodeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        provider, namespace = build_place_search()
        places = geocode(
            provider, query.validated_data["q"], query.validated_data["limit"], namespace=namespace
        )
        return Response(
            {
                "results": [
                    {"label": p.label, "lat": p.lat, "lon": p.lon, "kind": p.kind} for p in places
                ]
            }
        )
