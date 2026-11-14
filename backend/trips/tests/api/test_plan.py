"""POST /api/plan against respx-mocked TomTom and Open-Meteo (PLAN §9, API tests)."""

from __future__ import annotations

import base64
import gzip
import json
import math
from collections.abc import Callable
from itertools import pairwise
from typing import Any

import httpx
import pytest
from rest_framework import serializers

from trips.api.serializers import PlanSerializer
from trips.services import openmeteo
from trips.services.weather import MAX_LOCATIONS
from trips.tests.api.conftest import (
    OPEN_METEO_URL,
    SECRET_KEY,
    Upstreams,
    form,
    ndjson_events,
    open_meteo_ok,
    plan_body,
    tomtom_error,
)

Api = Callable[..., Any]


def error_of(response: Any) -> dict[str, Any]:
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details", "retry_after_s"}
    error: dict[str, Any] = body["error"]
    return error


# --- happy path ------------------------------------------------------------------------


def test_json_plan_happy_path(api: Api, upstreams: Upstreams) -> None:
    response = api(plan_body())

    assert response.status_code == 200, response.content
    assert response["Content-Type"] == "application/json"
    assert "tomtom;dur=" in response["Server-Timing"]
    assert response["X-Request-ID"]
    plan = response.json()
    assert plan["departure_utc"] == "2026-11-14T10:00:00Z"
    assert plan["origin_tz"] == "America/Denver"
    assert plan["warnings"] == []
    assert [r["id"] for r in plan["routes"]] == ["A", "B", "C"]
    assert {r["source"] for r in plan["routes"]} == {"tomtom"}

    for route in plan["routes"]:
        summary = route["summary"]
        assert summary["duration_s"] == summary["driving_s"]  # HOS off
        assert route["stops"] == []
        assert route["geometry"]["encoding"] == "polyline6"
        assert set(route["intervals"]) == {"10", "25", "50"}
        for interval, block in route["intervals"].items():
            cps = block["checkpoints"]
            assert cps[0]["kind"] == "origin"
            assert cps[0]["mile"] == 0
            assert cps[-1]["kind"] == "destination"
            assert cps[-1]["mile"] == pytest.approx(summary["distance_mi"], abs=0.06)
            assert sum(c["owned_mi"] for c in cps) == pytest.approx(
                summary["distance_mi"], abs=0.06
            )
            assert all(c["status"] == "ok" for c in cps)
            gaps = {round(b["mile"] - a["mile"], 6) for a, b in pairwise(cps[:-1])}
            assert gaps == {float(interval)}
            agg = block["aggregates"]
            assert agg["checkpoint_count"] == len(cps)
            assert sum(agg["miles_by_level"].values()) == pytest.approx(
                summary["distance_mi"], abs=0.06
            )

    for interval in ("10", "25", "50"):
        rec = plan["recommendation"][interval]
        assert sorted(rec["ranking"]) == ["A", "B", "C"]
        assert rec["route_id"] == rec["ranking"][0]
        assert set(rec["decided_by"]) == set(rec["ranking"][1:])
        assert all(len(k) == 5 for k in rec["keys"].values())

    heat = plan["heatmap"]
    assert heat["hours"] == 49
    assert 0 < heat["count"] <= 250
    assert len(heat["lat"]) == len(heat["lon"]) == heat["count"]
    assert len(base64.b64decode(heat["levels_b64"])) == heat["count"] * 49
    assert len(base64.b64decode(heat["wind_mph_x10_b64"])) == heat["count"] * 49 * 2
    assert heat["base_time_utc"] == "2026-11-14T10:00:00Z"


def test_upstream_requests_use_truck_kg_and_batched_weather(api: Api, upstreams: Upstreams) -> None:
    assert api(plan_body()).status_code == 200

    route_call = upstreams.route.calls[0].request
    params = httpx.QueryParams(route_call.url.query)
    assert params["travelMode"] == "truck"
    assert params["vehicleWeight"] == "20412"  # 45,000 lb x 0.45359237, rounded
    assert params["maxAlternatives"] == "4"
    assert params["vehicleCommercial"] == "true"
    assert params.get_list("extendedRouteRepresentation") == ["distance", "travelTime"]
    assert "39.739200,-104.990300:40.760800,-111.891000" in route_call.url.path

    batches = [form(call.request) for call in upstreams.weather.calls]
    sizes = [len(b["latitude"].split(",")) for b in batches]
    assert all(size <= openmeteo.BATCH_SIZE for size in sizes)
    cells = {
        (lat, lon)
        for b in batches
        for lat, lon in zip(b["latitude"].split(","), b["longitude"].split(","), strict=True)
    }
    assert len(cells) == sum(sizes) <= MAX_LOCATIONS  # deduplicated, within budget
    first = batches[0]
    assert first["wind_speed_unit"] == "mph"
    assert first["precipitation_unit"] == "inch"
    assert first["timeformat"] == "unixtime"
    assert first["hourly"] == "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
    assert first["start_hour"] == "2026-11-14T09:00"  # floor_hour(departure) - 1 h
    assert first["end_hour"] == "2026-11-16T11:00"  # departure + 48 h + 1 h
    assert all(b["start_hour"] == first["start_hour"] for b in batches)


def test_second_identical_plan_is_served_from_caches(api: Api, upstreams: Upstreams) -> None:
    first = api(plan_body()).json()
    calls = (upstreams.route.call_count, upstreams.weather.call_count)

    second = api(plan_body()).json()

    assert (upstreams.route.call_count, upstreams.weather.call_count) == calls
    assert second["routes"] == first["routes"]
    assert second["recommendation"] == first["recommendation"]


def test_hos_adds_stops_to_duration_and_etas(api: Api, upstreams: Upstreams) -> None:
    plan = api(plan_body(apply_hos=True)).json()

    by_id = {r["id"]: r for r in plan["routes"]}
    # Route C drives about 11.7 h: a 30 min break at 8 h and a 10 h rest at 11 h.
    c = by_id["C"]
    assert [s["kind"] for s in c["stops"]] == ["break", "rest"]
    assert c["summary"]["hos_stop_s"] == 30 * 60 + 10 * 3600
    assert c["summary"]["duration_s"] == c["summary"]["driving_s"] + c["summary"]["hos_stop_s"]
    assert 0 < c["stops"][0]["mile"] < c["stops"][1]["mile"] < c["summary"]["distance_mi"]
    # Route A (7.6 h of driving) needs no stop.
    assert by_id["A"]["stops"] == []


def test_response_matches_documented_schema(api: Api, upstreams: Upstreams) -> None:
    """Every key the presenter emits is in the OpenAPI serializers, and vice versa."""
    plan = api(plan_body(apply_hos=True)).json()
    assert_shape(plan, PlanSerializer())


def assert_shape(value: Any, field: Any, path: str = "plan") -> None:
    if isinstance(field, serializers.ListSerializer):
        assert isinstance(value, list), path
        for i, item in enumerate(value[:3]):
            assert_shape(item, field.child, f"{path}[{i}]")
        return
    if isinstance(field, serializers.Serializer):
        if value is None:
            assert field.allow_null, path
            return
        assert isinstance(value, dict), path
        assert set(value) == set(field.fields), f"{path}: {set(value) ^ set(field.fields)}"
        for name, child in field.fields.items():
            assert_shape(value[name], child, f"{path}.{name}")
        return
    if value is None:
        assert field.allow_null, f"{path} is null"
        return
    if isinstance(field, serializers.ChoiceField):
        assert value in field.choices, f"{path}={value!r}"


# --- NDJSON stream ---------------------------------------------------------------------


def test_ndjson_events_arrive_in_order(api: Api, upstreams: Upstreams) -> None:
    response = api(plan_body(), accept="application/x-ndjson")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/x-ndjson"
    events = ndjson_events(response)
    types = [e["type"] for e in events]
    assert types[:2] == ["meta", "routes"]
    assert types[-1] == "result"
    assert set(types[2:-1]) == {"progress"}
    assert events[0] == {
        "type": "meta",
        "departure_utc": "2026-11-14T10:00:00Z",
        "origin_tz": "America/Denver",
    }
    assert [r["id"] for r in events[1]["routes"]] == ["A", "B", "C"]
    assert "intervals" not in events[1]["routes"][0]
    progress = [(e["done"], e["total"]) for e in events[2:-1]]
    total = upstreams.weather.call_count
    assert progress == [(i, total) for i in range(total + 1)]
    assert events[-1]["plan"]["routes"][0]["geometry"] == events[1]["routes"][0]["geometry"]


def test_ndjson_gzip_stream_decodes_line_by_line(api: Api, upstreams: Upstreams) -> None:
    response = api(plan_body(), accept="application/x-ndjson", HTTP_ACCEPT_ENCODING="gzip")

    assert response["Content-Encoding"] == "gzip"
    raw = b"".join(response.streaming_content)
    lines = gzip.decompress(raw).decode().splitlines()
    assert json.loads(lines[-1])["type"] == "result"


def test_plan_payload_fits_the_gzip_budget(api: Api, upstreams: Upstreams) -> None:
    response = api(plan_body())
    assert len(gzip.compress(response.content)) < 150 * 1024


# --- routes: fewer than three ----------------------------------------------------------


def _two_route_response(upstreams: Upstreams) -> dict[str, Any]:
    routes = upstreams.denver_slc["routes"]
    return {"routes": [routes[0], routes[2]]}  # A and C are distinct


def test_fewer_than_three_routes_adds_a_via_point_detour(api: Api, upstreams: Upstreams) -> None:
    via_route = {"routes": [upstreams.denver_slc["routes"][1]]}  # distinct, < 1.5x fastest

    def answer(request: httpx.Request) -> httpx.Response:
        stops = request.url.path.split("/calculateRoute/")[1].split("/")[0].split(":")
        if len(stops) == 3:
            assert httpx.QueryParams(request.url.query)["maxAlternatives"] == "0"
            return httpx.Response(200, json=via_route)
        return httpx.Response(200, json=_two_route_response(upstreams))

    upstreams.route.mock(side_effect=answer)

    plan = api(plan_body()).json()

    assert [r["source"] for r in plan["routes"]] == ["tomtom", "tomtom", "via_point"]
    assert upstreams.route.call_count == 3  # the trip plus one detour per side
    assert plan["warnings"] == []


def test_slow_detours_are_rejected(api: Api, upstreams: Upstreams) -> None:
    slow = {"routes": [upstreams.denver_slc["routes"][3]]}  # 1.55x the fastest duration

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path.count(":") == 2:
            return httpx.Response(200, json=slow)
        return httpx.Response(200, json=_two_route_response(upstreams))

    upstreams.route.mock(side_effect=answer)

    plan = api(plan_body()).json()

    assert len(plan["routes"]) == 2
    assert [w["code"] for w in plan["warnings"]] == ["FEWER_THAN_3_ROUTES"]


def test_fewer_than_three_routes_warns_when_no_detour_works(api: Api, upstreams: Upstreams) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path.count(":") == 2:
            return tomtom_error("NO_ROUTE_FOUND")
        return httpx.Response(200, json=_two_route_response(upstreams))

    upstreams.route.mock(side_effect=answer)

    plan = api(plan_body()).json()

    assert len(plan["routes"]) == 2
    assert plan["warnings"] == [
        {
            "code": "FEWER_THAN_3_ROUTES",
            "message": "Only 2 distinct truck routes exist for this trip.",
        }
    ]


# --- upstream failures -----------------------------------------------------------------


@pytest.mark.parametrize("code", ["NO_ROUTE_FOUND", "MAP_MATCHING_FAILURE"])
@pytest.mark.parametrize("accept", ["application/json", "application/x-ndjson"])
def test_no_route_is_422(api: Api, upstreams: Upstreams, code: str, accept: str) -> None:
    upstreams.route.mock(return_value=tomtom_error(code))

    response = api(plan_body(), accept=accept)

    assert response.status_code == 422
    assert response["Content-Type"] == "application/json"
    error = error_of(response)
    assert error["code"] == "NO_ROUTE"
    assert error["retry_after_s"] is None
    assert upstreams.weather.call_count == 0


def test_open_meteo_429_is_retried_then_503_with_retry_after(
    api: Api, upstreams: Upstreams
) -> None:
    upstreams.weather_side_effect(
        lambda request: httpx.Response(
            429,
            json={"error": True, "reason": "Minutely API request limit exceeded."},
            headers={"Retry-After": "42"},
        )
    )

    response = api(plan_body())

    assert response.status_code == 503
    error = error_of(response)
    assert error["code"] == "UPSTREAM_RATE_LIMITED"
    assert error["retry_after_s"] == 42
    assert response["Retry-After"] == "42"
    # Every batch is tried three times (two retries) before giving up.
    assert upstreams.weather.call_count % 3 == 0


def test_open_meteo_429_recovers_within_the_retries(api: Api, upstreams: Upstreams) -> None:
    attempts: list[int] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        if len(attempts) == 1:
            return httpx.Response(429, headers={"x-ratelimit-reset": "0"})
        return open_meteo_ok(request)

    upstreams.weather_side_effect(flaky)

    response = api(plan_body())

    assert response.status_code == 200
    assert response.json()["warnings"] == []


def test_open_meteo_429_mid_stream_is_an_error_event(api: Api, upstreams: Upstreams) -> None:
    upstreams.weather_side_effect(lambda request: httpx.Response(429))

    response = api(plan_body(), accept="application/x-ndjson")

    assert response.status_code == 200  # the stream had already started
    events = ndjson_events(response)
    assert [e["type"] for e in events[:2]] == ["meta", "routes"]
    assert events[-1]["type"] == "error"
    assert events[-1]["error"]["code"] == "UPSTREAM_RATE_LIMITED"
    assert events[-1]["error"]["retry_after_s"] == 30
    assert all(e["type"] != "result" for e in events)


def test_tomtom_timeout_is_504(api: Api, upstreams: Upstreams) -> None:
    upstreams.route.mock(side_effect=httpx.ReadTimeout("read timed out"))

    response = api(plan_body())

    assert response.status_code == 504
    assert error_of(response)["code"] == "UPSTREAM_TIMEOUT"
    assert upstreams.route.call_count == 1  # timeouts are not retried


def test_open_meteo_timeout_is_504(api: Api, upstreams: Upstreams) -> None:
    upstreams.weather_side_effect(lambda request: (_ for _ in ()).throw(httpx.ConnectTimeout("")))

    response = api(plan_body())

    assert response.status_code == 504
    assert error_of(response)["code"] == "UPSTREAM_TIMEOUT"


def test_tomtom_5xx_is_retried_then_502(api: Api, upstreams: Upstreams) -> None:
    upstreams.route.mock(return_value=httpx.Response(503, text="<html>busy</html>"))

    response = api(plan_body())

    assert response.status_code == 502
    assert error_of(response)["code"] == "UPSTREAM_UNAVAILABLE"
    assert upstreams.route.call_count == 3


def test_tomtom_429_is_503_with_retry_after(api: Api, upstreams: Upstreams) -> None:
    upstreams.route.mock(return_value=httpx.Response(429, headers={"Retry-After": "7"}))

    response = api(plan_body())

    assert response.status_code == 503
    assert error_of(response)["retry_after_s"] == 7


def test_tomtom_malformed_payload_is_502(api: Api, upstreams: Upstreams) -> None:
    upstreams.route.mock(return_value=httpx.Response(200, json={"routes": [{"summary": {}}]}))

    assert error_of(api(plan_body()))["code"] == "UPSTREAM_UNAVAILABLE"


def test_one_failed_weather_batch_marks_cells_no_data(api: Api, upstreams: Upstreams) -> None:
    def one_bad_batch(request: httpx.Request) -> httpx.Response:
        data = form(request)
        # The batch that starts at the origin's cell fails every attempt; the rest succeed.
        if data["latitude"].startswith("39.7,") and data["longitude"].startswith("-105.0,"):
            return httpx.Response(500)
        return open_meteo_ok(request)

    upstreams.weather_side_effect(one_bad_batch)

    plan = api(plan_body()).json()

    assert [w["code"] for w in plan["warnings"]] == ["WEATHER_PARTIAL"]
    statuses = [
        c["status"]
        for r in plan["routes"]
        for block in r["intervals"].values()
        for c in block["checkpoints"]
    ]
    assert "no_data" in statuses
    assert "ok" in statuses
    no_data = next(
        c
        for r in plan["routes"]
        for c in r["intervals"]["10"]["checkpoints"]
        if c["status"] == "no_data"
    )
    assert (no_data["level"], no_data["weather"], no_data["score"]) == (None, None, None)


def test_all_weather_batches_failing_is_502(api: Api, upstreams: Upstreams) -> None:
    upstreams.weather_side_effect(lambda request: httpx.Response(200, json={"bad": "payload"}))

    response = api(plan_body())

    assert response.status_code == 502
    assert error_of(response)["code"] == "UPSTREAM_UNAVAILABLE"


def test_missing_tomtom_key_is_502_without_calling_out(
    api: Api, upstreams: Upstreams, settings: Any
) -> None:
    settings.TOMTOM_API_KEY = ""

    response = api(plan_body())

    assert response.status_code == 502
    assert upstreams.route.call_count == 0


def test_unexpected_exception_is_500_with_request_id(
    api: Api, upstreams: Upstreams, monkeypatch: pytest.MonkeyPatch
) -> None:
    from trips.services import planner

    def boom(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(planner, "recommend", boom)

    response = api(plan_body(), HTTP_X_REQUEST_ID="req-test-0001")

    assert response.status_code == 500
    error = error_of(response)
    assert error["code"] == "INTERNAL"
    assert error["details"] == {"request_id": "req-test-0001"}
    assert "kaboom" not in response.content.decode()


# --- validation ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"origin": None}, "origin"),
        ({"destination": {"lat": 91, "lon": 0}}, "destination"),
        ({"destination": {"lat": 40, "lon": -181}}, "destination"),
        ({"load_weight_lb": 0}, "load_weight_lb"),
        ({"load_weight_lb": 200_001}, "load_weight_lb"),
        ({"load_weight_lb": "heavy"}, "load_weight_lb"),
        ({"departure_local": "tomorrow"}, "departure_local"),
        ({"departure_local": "2026-11-14T03:00-07:00"}, "departure_local"),
        ({"departure_local": "2026-11-14T01:44"}, "departure_local"),  # 16 min in the past
        ({"departure_local": "2026-11-21T03:01"}, "departure_local"),  # past now + 7 days
        ({"destination": {"lat": 39.7393, "lon": -104.9904}}, "destination"),  # < 1 mile
    ],
)
def test_validation_errors_are_400_with_field_details(
    api: Api, upstreams: Upstreams, overrides: dict[str, Any], field: str
) -> None:
    response = api(plan_body(**overrides))

    assert response.status_code == 400, response.content
    error = error_of(response)
    assert error["code"] == "VALIDATION"
    assert field in error["details"]
    assert upstreams.route.call_count == 0


@pytest.mark.parametrize("body", ["{not json", '{"load_weight_lb": NaN}'])
def test_malformed_json_is_400(api: Api, upstreams: Upstreams, body: str) -> None:
    response = api(body)

    assert response.status_code == 400
    assert error_of(response)["code"] == "VALIDATION"


def test_departure_slightly_in_the_past_is_clamped_to_now(api: Api, upstreams: Upstreams) -> None:
    plan = api(plan_body(departure_local="2026-11-14T01:50")).json()  # 10 min ago

    assert plan["departure_utc"] == "2026-11-14T09:00:00Z"
    departs = httpx.QueryParams(upstreams.route.calls[0].request.url.query)["departAt"]
    assert departs == "now"


def test_over_federal_limit_is_allowed_with_a_warning(api: Api, upstreams: Upstreams) -> None:
    plan = api(plan_body(load_weight_lb=95_000)).json()

    assert [w["code"] for w in plan["warnings"]] == ["OVER_FEDERAL_GROSS_LIMIT"]
    params = httpx.QueryParams(upstreams.route.calls[0].request.url.query)
    assert params["vehicleWeight"] == str(round(95_000 * 0.45359237))


def test_plan_throttle_is_429_with_retry_after(api: Api, upstreams: Upstreams) -> None:
    for _ in range(10):
        assert api(plan_body()).status_code == 200

    response = api(plan_body())

    assert response.status_code == 429
    error = error_of(response)
    assert error["code"] == "RATE_LIMITED"
    assert isinstance(error["retry_after_s"], int)
    assert error["retry_after_s"] >= 1


# --- secrets ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "scenario",
    ["ok", "no_route", "tomtom_500", "tomtom_timeout", "weather_429", "bad_key"],
)
def test_secrets_never_appear_in_responses_or_logs(
    api: Api, upstreams: Upstreams, caplog: pytest.LogCaptureFixture, scenario: str
) -> None:
    caplog.set_level("DEBUG")
    match scenario:
        case "no_route":
            upstreams.route.mock(return_value=tomtom_error("NO_ROUTE_FOUND"))
        case "tomtom_500":
            upstreams.route.mock(return_value=httpx.Response(500, text=f"key={SECRET_KEY}"))
        case "tomtom_timeout":
            upstreams.route.mock(side_effect=httpx.ReadTimeout(f"GET ...?key={SECRET_KEY}"))
        case "weather_429":
            upstreams.weather_side_effect(lambda request: httpx.Response(429))
        case "bad_key":
            upstreams.route.mock(return_value=httpx.Response(403, text="Developer Inactive"))

    for accept in ("application/json", "application/x-ndjson"):
        response = api(plan_body(), accept=accept)
        content = (
            b"".join(response.streaming_content) if response.streaming else response.content
        ).decode()
        assert SECRET_KEY not in content
        assert SECRET_KEY not in json.dumps(dict(response.items()))
    assert SECRET_KEY not in caplog.text


def test_weather_requests_do_not_carry_the_tomtom_key(api: Api, upstreams: Upstreams) -> None:
    api(plan_body())
    for call in upstreams.weather.calls:
        assert SECRET_KEY not in call.request.content.decode()
        assert SECRET_KEY not in str(call.request.url)
    assert str(upstreams.weather.calls[0].request.url) == OPEN_METEO_URL


def test_no_data_metrics_are_finite(api: Api, upstreams: Upstreams) -> None:
    plan = api(plan_body()).json()
    for rec in plan["recommendation"].values():
        for key in rec["keys"].values():
            assert all(v is None or math.isfinite(v) for v in key)
