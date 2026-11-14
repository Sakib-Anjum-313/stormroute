from __future__ import annotations

import pytest

from trips.domain.detours import (
    MAX_OFFSET_M,
    MIN_OFFSET_M,
    detour_acceptable,
    detour_offset_m,
    detour_vias,
)
from trips.domain.geometry import haversine_m
from trips.domain.types import LatLon
from trips.tests.unit.conftest import straight_route

KM = 1000.0


@pytest.mark.parametrize(
    ("lon1", "expected_m"),
    [
        (-104.9, MIN_OFFSET_M),  # ~8.5 km apart: 15% is 1.3 km, clamped up to 20 km
        (-95.0, None),  # ~850 km apart: 15% is ~128 km, inside the clamp
        (-80.0, MAX_OFFSET_M),  # ~2,100 km apart: clamped down to 150 km
    ],
)
def test_offset_is_15_percent_clamped(lon1: float, expected_m: float | None) -> None:
    o, d = LatLon(40.0, -105.0), LatLon(40.0, lon1)
    expected = 0.15 * haversine_m(o, d) if expected_m is None else expected_m
    assert detour_offset_m(o, d) == pytest.approx(expected)


def test_vias_are_perpendicular_at_the_midpoint() -> None:
    geom = straight_route(lat=40.0, lon0=-105.0, lon1=-95.0)
    o, d = geom.points[0], geom.points[-1]
    left, right = detour_vias(geom, o, d)
    offset = detour_offset_m(o, d)
    # East-west route: the vias sit due north and due south of the midpoint.
    assert left.lon == pytest.approx(-100.0, abs=1e-6)
    assert right.lon == pytest.approx(-100.0, abs=1e-6)
    assert left.lat > 40.0 > right.lat
    mid = LatLon(40.0, -100.0)
    assert haversine_m(mid, left) == pytest.approx(offset, rel=1e-3)
    assert haversine_m(mid, right) == pytest.approx(offset, rel=1e-3)


def test_coincident_endpoints_are_rejected() -> None:
    geom = straight_route()
    p = geom.points[0]
    with pytest.raises(ValueError, match="coincide"):
        detour_vias(geom, p, p)


@pytest.mark.parametrize(
    ("duration_s", "ok"), [(3600 * 1.5, True), (3600 * 1.5 + 1, False), (3600, True)]
)
def test_duration_cap_is_one_and_a_half_times_fastest(duration_s: float, ok: bool) -> None:
    assert detour_acceptable(duration_s, 3600) is ok


def test_offset_never_below_floor_for_short_trips() -> None:
    assert detour_offset_m(LatLon(40, -105), LatLon(40.0001, -105)) == MIN_OFFSET_M
    assert MIN_OFFSET_M == 20 * KM
