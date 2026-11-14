"""Planner behavior that needs no HTTP: fixture providers drive it directly."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.cache import cache

from trips.services import clock, planner, weather
from trips.services.fixtures import FixtureRouting, FixtureWeather
from trips.services.planner import (
    Endpoint,
    MetaEvent,
    Planner,
    PlanRequest,
    ProgressEvent,
    ResultEvent,
    RoutesEvent,
)

NOW = 1_794_646_800.0  # 2026-11-14T09:00:00Z


@pytest.fixture(autouse=True)
def _frozen(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(clock, "now_utc", lambda: NOW)
    planner.clear_memo()
    cache.clear()
    yield
    planner.clear_memo()


def request(**overrides: Any) -> PlanRequest:
    fields: dict[str, Any] = {
        "origin": Endpoint("Denver", 39.7392, -104.9903),
        "destination": Endpoint("Salt Lake City", 40.7608, -111.8910),
        "departure_utc": NOW + 3600,
        "origin_tz": "America/Denver",
        "load_weight_lb": 45_000,
        "apply_hos": False,
    }
    fields.update(overrides)
    return PlanRequest(**fields)


def make_planner(scenario: str = "default") -> Planner:
    return Planner(FixtureRouting(scenario), FixtureWeather(scenario), memo_ns=scenario)


def test_stream_event_order_and_timings() -> None:
    p = make_planner()
    events = list(p.stream(request()))

    assert isinstance(events[0], MetaEvent)
    assert isinstance(events[1], RoutesEvent)
    assert all(isinstance(e, ProgressEvent) for e in events[2:-1])
    assert isinstance(events[-1], ResultEvent)
    assert p.timings.compute_ms > 0
    assert p.timings.header().startswith("tomtom;dur=")


def test_budget_guard_coarsens_heatmap_then_checkpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    baseline = make_planner().plan(request())
    monkeypatch.setattr(planner, "MAX_LOCATIONS", 120)

    coarse = make_planner("coarse").plan(request())

    codes = {w.code: w.message for w in coarse.warnings}
    assert "WEATHER_COARSENED" in codes
    assert "heatmap" in codes["WEATHER_COARSENED"]
    assert "checkpoints_25_50" in codes["WEATHER_COARSENED"]
    assert coarse.heatmap.cell_deg > baseline.heatmap.cell_deg
    cells_25 = {c.checkpoint.lookup_cell for c in coarse.intervals["A"][25].checkpoints}
    assert all(round(lat * 10) % 2 == 0 and round(lon * 10) % 2 == 0 for lat, lon in cells_25)
    # The checkpoints themselves (and so the mileage) are unchanged; only lookup cells move.
    assert [c.checkpoint.mile for c in coarse.intervals["A"][25].checkpoints] == [
        c.checkpoint.mile for c in baseline.intervals["A"][25].checkpoints
    ]


def test_checkpoints_past_the_forecast_horizon_are_no_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(weather, "FORECAST_DAYS", 1)
    plan = make_planner().plan(request(departure_utc=NOW + 20 * 3600))

    assert "BEYOND_FORECAST_HORIZON" in {w.code for w in plan.warnings}
    statuses = {c.assessment.status for c in plan.intervals["A"][10].checkpoints}
    assert statuses == {"ok", "no_data"} or statuses == {"no_data"}


def test_route_phase_is_memoized_per_trip() -> None:
    calls: list[int] = []
    routing = FixtureRouting()
    original = routing.calculate_routes

    def counting(*args: Any, **kwargs: Any) -> Any:
        calls.append(1)
        return original(*args, **kwargs)

    routing.calculate_routes = counting  # type: ignore[method-assign]
    p = Planner(routing, FixtureWeather(), memo_ns="memo-test")
    p.plan(request())
    p.plan(request(apply_hos=True))  # HOS does not change the routes
    assert calls == [1]
    p.plan(request(load_weight_lb=20_000))
    assert calls == [1, 1]
