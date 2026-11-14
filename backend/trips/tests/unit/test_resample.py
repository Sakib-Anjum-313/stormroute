from __future__ import annotations

import itertools

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trips.domain.geometry import METERS_PER_MILE, cumulative_m, point_segment_distance_m
from trips.domain.resample import mark_distances_m, position_at, resample, route_geom
from trips.domain.types import LatLon, RouteGeom
from trips.tests.unit.conftest import straight_route


def test_known_polyline_hand_computed_marks() -> None:
    # Two equal legs along the equator; total scaled to exactly 25 miles.
    pts = [LatLon(0.0, 0.0), LatLon(0.0, 0.1), LatLon(0.0, 0.2)]
    geom = route_geom(pts, 25 * METERS_PER_MILE, 1800, [])
    samples = resample(geom, 10)
    assert [s.mile for s in samples] == pytest.approx([0.0, 10.0, 20.0, 25.0])
    assert [s.kind for s in samples] == ["origin", "interval", "interval", "destination"]
    assert samples[1].pos.lon == pytest.approx(0.08)  # 10 of 25 miles = 40% of 0.2 degrees
    assert samples[2].pos.lon == pytest.approx(0.16)
    assert samples[0].pos == pts[0]
    assert samples[-1].pos == pts[-1]


def test_route_length_is_normalized_to_provider_length() -> None:
    pts = [LatLon(40.0, -105.0), LatLon(40.0, -104.0)]
    raw = cumulative_m(pts)[-1]
    geom = route_geom(pts, raw * 1.004, 100, [])
    assert geom.cum_m[-1] == raw * 1.004
    assert geom.length_m == raw * 1.004


def test_exact_multiple_has_no_duplicate_destination() -> None:
    geom = straight_route()
    marks = mark_distances_m(50 * METERS_PER_MILE, 10)
    assert marks == pytest.approx([m * METERS_PER_MILE for m in (0, 10, 20, 30, 40, 50)])
    assert len(resample(geom, 1000)) == 2  # interval longer than the route: origin + destination


def test_zero_length_segments_are_tolerated() -> None:
    pts = [LatLon(40.0, -105.0), LatLon(40.0, -105.0), LatLon(40.0, -104.0)]
    geom = route_geom(pts, cumulative_m(pts)[-1], 100, [])
    assert position_at(geom, 0.0) == pts[0]
    assert position_at(geom, -5.0) == pts[0]
    assert position_at(geom, geom.length_m + 5) == pts[-1]
    assert position_at(geom, geom.length_m / 2).lon == pytest.approx(-104.5)


@pytest.mark.parametrize(
    ("points", "length_m", "match"),
    [
        ([LatLon(0, 0)], 10.0, "two points"),
        ([LatLon(0, 0), LatLon(0, 1)], 0.0, "length_m"),
        ([LatLon(0, 0), LatLon(0, 0)], 10.0, "zero length"),
    ],
)
def test_route_geom_validation(points: list[LatLon], length_m: float, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        route_geom(points, length_m, 1, [])


@pytest.mark.parametrize(("length_m", "interval"), [(0.0, 10.0), (10.0, 0.0)])
def test_mark_validation(length_m: float, interval: float) -> None:
    with pytest.raises(ValueError, match="must be positive"):
        mark_distances_m(length_m, interval)


@st.composite
def routes(draw: st.DrawFn) -> RouteGeom:
    lat = draw(st.floats(25.0, 49.0))
    lon = draw(st.floats(-124.0, -68.0))
    pts = [LatLon(lat, lon)]
    n = draw(st.integers(1, 25))
    for _ in range(n):
        dlat = draw(st.floats(-0.4, 0.4))
        dlon = draw(st.floats(0.01, 0.6))
        pts.append(LatLon(pts[-1].lat + dlat, pts[-1].lon + dlon))
    raw = cumulative_m(pts)[-1]
    scale = draw(st.floats(0.99, 1.01))
    return route_geom(pts, raw * scale, 3600.0, [])


@settings(max_examples=150, deadline=None)
@given(geom=routes(), interval=st.sampled_from([10.0, 25.0, 50.0]) | st.floats(0.5, 80.0))
def test_resample_properties(geom: RouteGeom, interval: float) -> None:
    samples = resample(geom, interval)
    miles = [s.mile for s in samples]
    length_mi = geom.length_m / METERS_PER_MILE

    assert samples[0].pos == geom.points[0]
    assert samples[-1].pos == geom.points[-1]
    assert miles[0] == 0.0
    assert miles[-1] == pytest.approx(length_mi)
    assert all(b > a for a, b in itertools.pairwise(miles))
    gaps = [b - a for a, b in itertools.pairwise(miles)]
    for gap in gaps[:-1]:
        assert gap == pytest.approx(interval)
    assert 0 < gaps[-1] <= interval + 1e-9
    segments = list(zip(geom.points, geom.points[1:], strict=False))
    for s in samples:
        nearest = min(point_segment_distance_m(s.pos, a, b) for a, b in segments)
        assert nearest <= 1.0
