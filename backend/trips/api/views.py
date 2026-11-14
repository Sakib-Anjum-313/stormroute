import json
import time
import zlib
from collections.abc import Iterator

from django.conf import settings
from django.http import HttpRequest, StreamingHttpResponse
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from trips.api.serializers import HealthSerializer

NDJSON = "application/x-ndjson"


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
