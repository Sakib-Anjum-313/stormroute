from __future__ import annotations

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trips.domain.attribution import aggregate, owned_miles
from trips.domain.checkpoints import build_checkpoints
from trips.domain.geometry import METERS_PER_MILE
from trips.domain.levels import Level
from trips.domain.risk import NO_DATA, Assessment, VariableLevels
from trips.domain.types import RouteGeom
from trips.tests.unit.conftest import straight_route


def marks(length_mi: float, interval_mi: float) -> list[float]:
    out = []
    n = 0
    while n * interval_mi < length_mi:
        out.append(n * interval_mi)
        n += 1
    return [*out, length_mi]


def ok(level: Level) -> Assessment:
    return Assessment("ok", level, VariableLevels(level, Level.LOW, Level.LOW), ())


def test_skill_example_25_miles_at_10() -> None:
    assert owned_miles([0, 10, 20, 25], 25) == pytest.approx([5, 10, 7.5, 2.5])


@pytest.mark.parametrize(
    ("length", "interval", "expected"),
    [
        (50, 25, [12.5, 25, 12.5]),
        (5, 10, [2.5, 2.5]),
        (10.0001, 10, [5, 5.00005, 0.00005]),
    ],
)
def test_owned_miles_table(length: float, interval: float, expected: list[float]) -> None:
    assert owned_miles(marks(length, interval), length) == pytest.approx(expected)


def test_owned_miles_empty_and_clipped() -> None:
    assert owned_miles([], 10) == []
    assert owned_miles([0, 30], 20) == pytest.approx([15, 5])


@settings(max_examples=300, deadline=None)
@given(
    length=st.floats(0.01, 3000.0),
    interval=st.sampled_from([10.0, 25.0, 50.0]) | st.floats(0.5, 100.0),
)
def test_owned_miles_sum_to_route_length(length: float, interval: float) -> None:
    owned = owned_miles(marks(length, interval), length)
    assert math.fsum(owned) == pytest.approx(length, rel=1e-12, abs=1e-9)
    assert all(o > 0 for o in owned)
    assert owned[0] == pytest.approx(min(interval, length) / 2)


@pytest.mark.parametrize("interval", [10.0, 25.0, 50.0])
def test_checkpoint_owned_miles_sum_to_route_length(interval: float) -> None:
    geom: RouteGeom = straight_route(lon1=-96.0)
    cps = build_checkpoints(geom, interval, 0.0)
    assert math.fsum(c.owned_mi for c in cps) == pytest.approx(geom.length_m / METERS_PER_MILE)


def test_aggregate_miles_avg_and_max() -> None:
    owned = [5.0, 10.0, 7.5, 2.5]
    agg = aggregate(owned, [ok(Level.LOW), ok(Level.SEVERE), NO_DATA, ok(Level.NO_TRAVEL)])
    assert agg.miles_by_level[Level.LOW] == 5.0
    assert agg.severe_mi == 10.0
    assert agg.no_travel_mi == 2.5
    assert agg.high_mi == 0.0
    assert agg.no_data_mi == 7.5
    # (0*5 + 3*10 + 4*2.5) / (5 + 10 + 2.5): NO_DATA miles are excluded from the denominator.
    assert agg.avg_risk == pytest.approx(40 / 17.5)
    assert agg.max_level is Level.NO_TRAVEL
    assert agg.checkpoint_count == 4


def test_aggregate_all_no_data() -> None:
    agg = aggregate([1.0, 2.0], [NO_DATA, NO_DATA])
    assert agg.avg_risk is None
    assert agg.max_level is None
    assert agg.no_data_mi == 3.0


def test_aggregate_length_mismatch() -> None:
    with pytest.raises(ValueError, match="same length"):
        aggregate([1.0], [])
