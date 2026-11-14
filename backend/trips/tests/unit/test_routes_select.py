from __future__ import annotations

import pytest

from trips.domain.geometry import cumulative_m
from trips.domain.resample import route_geom
from trips.domain.routes_select import select_routes
from trips.domain.types import LatLon, ProgressEntry, RouteGeom
from trips.tests.unit.conftest import straight_route

DEG_PER_KM = 1 / 111.195


def shifted(km_north: float, *, lon1: float = -104.0) -> RouteGeom:
    return straight_route(lat=40.0 + km_north * DEG_PER_KM, lon1=lon1)


def branch(shared_frac: float, km_north: float) -> RouteGeom:
    """A copy of the base line that leaves it after ``shared_frac`` of its length."""
    base = shifted(0.0)
    split_lon = -105.0 + shared_frac
    pts = [
        p if p.lon <= split_lon + 1e-9 else LatLon(p.lat + km_north * DEG_PER_KM, p.lon)
        for p in base.points
    ]
    length = cumulative_m(pts)[-1]
    return route_geom(pts, length, 3600, [ProgressEntry(len(pts) - 1, length, 3600)])


def test_near_copy_is_a_duplicate() -> None:
    routes = [shifted(0.0), shifted(0.1), shifted(50.0), shifted(-50.0)]
    sel = select_routes(routes)
    assert sel.duplicate_of == {1: 0}
    assert sel.kept == (0, 2, 3)


def test_keeps_primary_plus_the_two_that_maximize_minimum_difference() -> None:
    routes = [
        shifted(0.0),  # A
        branch(0.7, 20.0),  # shares 70% with A
        branch(0.3, 40.0),  # shares 30% with A
        branch(0.5, 60.0),  # shares 50% with A
    ]
    sel = select_routes(routes)
    assert sel.duplicate_of == {}
    # (A, 30%, 50%) has min difference ~0.5; any set with the 70% branch has ~0.3.
    assert sel.kept == (0, 2, 3)


def test_prefix_of_a_route_is_a_duplicate() -> None:
    # Every 1-mile sample of the shorter route lies on A.
    sel = select_routes([shifted(0.0), shifted(0.0, lon1=-104.5)])
    assert sel.duplicate_of == {1: 0}
    assert sel.kept == (0,)


def test_partial_overlap_below_85_percent_is_distinct() -> None:
    sel = select_routes([shifted(0.0), branch(0.8, 20.0)])
    assert sel.kept == (0, 1)
    assert sel.duplicate_of == {}


def test_overlap_at_or_above_85_percent_is_a_duplicate() -> None:
    sel = select_routes([shifted(0.0), branch(0.9, 20.0)])
    assert sel.duplicate_of == {1: 0}


def test_few_routes_are_all_kept_and_edge_cases() -> None:
    assert select_routes([]).kept == ()
    two = [shifted(0.0), shifted(30.0)]
    assert select_routes(two).kept == (0, 1)
    assert select_routes(two, keep=1).kept == (0,)


def test_recorded_fixture_yields_three_distinct_routes(denver_slc: list[RouteGeom]) -> None:
    sel = select_routes(denver_slc)
    assert len(sel.kept) == 3
    assert sel.kept[0] == 0


@pytest.mark.parametrize("keep", [2, 3])
def test_primary_route_is_always_kept(keep: int) -> None:
    routes = [shifted(0.0), shifted(20.0), shifted(40.0), shifted(-40.0)]
    sel = select_routes(routes, keep=keep)
    assert sel.kept[0] == 0
    assert len(sel.kept) == keep
