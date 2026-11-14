"""PLAN_FIXTURES=1: recorded data, no network, scenarios picked with X-Fixture."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
import respx
from django.test import Client

from trips.tests.api.conftest import ndjson_events, plan_body

Api = Callable[..., Any]


@pytest.fixture(autouse=True)
def _fixture_mode(settings: Any) -> Any:
    settings.PLAN_FIXTURES = True
    settings.TOMTOM_API_KEY = ""
    with respx.mock(assert_all_mocked=True) as router:  # any real HTTP call would fail
        yield router


def test_default_scenario_plans_the_nearest_recorded_trip(api: Api) -> None:
    response = api(plan_body())

    assert response.status_code == 200
    plan = response.json()
    assert [r["id"] for r in plan["routes"]] == ["A", "B", "C"]
    assert plan["warnings"] == []
    assert all(
        c["status"] == "ok" for r in plan["routes"] for c in r["intervals"]["10"]["checkpoints"]
    )


def test_default_scenario_streams(api: Api) -> None:
    events = ndjson_events(api(plan_body(), accept="application/x-ndjson"))
    assert [e["type"] for e in events][:2] == ["meta", "routes"]
    assert events[-1]["type"] == "result"


def test_two_routes_scenario_warns(api: Api) -> None:
    plan = api(plan_body(), HTTP_X_FIXTURE="two_routes").json()

    assert len(plan["routes"]) == 2
    assert [w["code"] for w in plan["warnings"]] == ["FEWER_THAN_3_ROUTES"]


def test_no_travel_all_scenario_blocks_every_route(api: Api) -> None:
    plan = api(plan_body(), HTTP_X_FIXTURE="no_travel_all").json()

    for interval in ("10", "25", "50"):
        assert plan["recommendation"][interval]["all_no_travel"] is True
    cp = plan["routes"][0]["intervals"]["10"]["checkpoints"][1]
    assert cp["level"] == "NO_TRAVEL"
    assert cp["triggers"][0]["rule"] == "wind_55_any_load"


def test_upstream_429_scenario(api: Api) -> None:
    response = api(plan_body(), HTTP_X_FIXTURE="upstream_429")

    assert response.status_code == 503
    assert response.json()["error"]["retry_after_s"] == 30
    events = ndjson_events(
        api(plan_body(), accept="application/x-ndjson", HTTP_X_FIXTURE="upstream_429")
    )
    assert [e["type"] for e in events] == ["meta", "routes", "error"]


def test_no_route_scenario(api: Api) -> None:
    response = api(plan_body(), HTTP_X_FIXTURE="no_route")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "NO_ROUTE"


def test_unknown_scenario_is_400(api: Api) -> None:
    response = api(plan_body(), HTTP_X_FIXTURE="tornado")
    assert response.status_code == 400
    assert "X-Fixture" in response.json()["error"]["details"]


def test_fixture_geocode_filters_the_built_in_places(client: Client) -> None:
    response = client.get("/api/geocode", {"q": "den"})
    labels = [r["label"] for r in response.json()["results"]]
    assert labels == ["Denver, CO, USA", "Denton, TX, USA"]
