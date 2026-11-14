from __future__ import annotations

import pytest

from trips.domain.checkpoints import build_checkpoints
from trips.domain.hos import BREAK_S, REST_S, Stop, plan_stops, stop_time_before_s, total_stop_s
from trips.tests.unit.conftest import straight_route

HR = 3600


@pytest.mark.parametrize(
    ("driving_h", "expected"),
    [
        (7, []),
        (8, []),  # arriving exactly at 8 h needs no break
        (9, [(8, "break")]),
        (11, [(8, "break")]),
        (12, [(8, "break"), (11, "rest")]),
        (20, [(8, "break"), (11, "rest"), (19, "break")]),
        (23, [(8, "break"), (11, "rest"), (19, "break"), (22, "rest")]),
    ],
)
def test_plan_stops(driving_h: float, expected: list[tuple[float, str]]) -> None:
    stops = plan_stops(driving_h * HR)
    assert [(s.at_driving_s / HR, s.kind) for s in stops] == expected
    for s in stops:
        assert s.duration_s == (BREAK_S if s.kind == "break" else REST_S)


def test_zero_driving_needs_no_stops() -> None:
    assert plan_stops(0) == []


def test_stop_time_before_counts_only_stops_already_started() -> None:
    stops = plan_stops(20 * HR)
    assert stop_time_before_s(stops, 8 * HR) == 0  # reached right as the break starts
    assert stop_time_before_s(stops, 8 * HR + 1) == BREAK_S
    assert stop_time_before_s(stops, 12 * HR) == BREAK_S + REST_S
    assert total_stop_s(stops) == 2 * BREAK_S + REST_S


def test_checkpoint_etas_include_stops_before_them() -> None:
    geom = straight_route(duration_s=10 * HR)  # ~85 km driven in 10 h
    stops = [Stop(8 * HR, BREAK_S, "break")]
    cps = build_checkpoints(geom, 5, 0.0, stops)
    for c in cps:
        offset = BREAK_S if c.driving_s > 8 * HR else 0
        assert c.eta_utc == pytest.approx(c.driving_s + offset)
    assert cps[-1].eta_utc == pytest.approx(10 * HR + BREAK_S)
