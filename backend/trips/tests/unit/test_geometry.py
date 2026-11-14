from __future__ import annotations

import itertools
import math

import pytest

from trips.domain.geometry import (
    EARTH_RADIUS_M,
    METERS_PER_DEGREE,
    PolylineIndex,
    cumulative_m,
    haversine_m,
    lerp,
    point_segment_distance_m,
    simplify,
    snap,
)
from trips.domain.types import LatLon


def test_haversine_one_degree_of_latitude() -> None:
    expected = EARTH_RADIUS_M * math.pi / 180
    assert haversine_m(LatLon(40.0, -105.0), LatLon(41.0, -105.0)) == pytest.approx(expected)


def test_haversine_known_city_pair_and_symmetry() -> None:
    denver, slc = LatLon(39.7392, -104.9903), LatLon(40.7608, -111.8910)
    d = haversine_m(denver, slc)
    assert d == pytest.approx(596_000, rel=0.01)  # published great-circle distance ~596 km
    assert haversine_m(slc, denver) == pytest.approx(d)
    assert haversine_m(denver, denver) == 0.0


def test_cumulative_and_lerp() -> None:
    pts = [LatLon(0, 0), LatLon(0, 1), LatLon(0, 3)]
    cum = cumulative_m(pts)
    assert cum[0] == 0
    assert cum[2] == pytest.approx(3 * cum[1])
    assert lerp(pts[0], pts[2], 0.5) == LatLon(0, 1.5)


@pytest.mark.parametrize(
    ("p", "deg", "cell"),
    [
        (LatLon(41.3149, -105.5911), 0.1, (41.3, -105.6)),
        (LatLon(41.36, -105.64), 0.1, (41.4, -105.6)),
        (LatLon(41.31, -105.59), 0.2, (41.4, -105.6)),
        (LatLon(-0.04, 0.04), 0.1, (0.0, 0.0)),
    ],
)
def test_snap_to_lattice(p: LatLon, deg: float, cell: tuple[float, float]) -> None:
    got = snap(p, deg)
    assert got == cell
    assert [math.copysign(1, v) for v in got] == [math.copysign(1, v) for v in cell]


def test_point_segment_distance() -> None:
    a, b = LatLon(40.0, -105.0), LatLon(40.0, -104.0)
    north = LatLon(40.01, -104.5)
    assert point_segment_distance_m(north, a, b) == pytest.approx(0.01 * METERS_PER_DEGREE)
    # Beyond the segment end the nearest point is the endpoint.
    east = LatLon(40.0, -103.99)
    assert point_segment_distance_m(east, a, b) == pytest.approx(haversine_m(east, b), rel=1e-3)
    # Degenerate segment.
    assert point_segment_distance_m(north, a, a) == pytest.approx(haversine_m(north, a), rel=1e-3)


def test_simplify_straight_line_and_corner() -> None:
    line = [LatLon(40.0, -105.0 + i * 0.01) for i in range(101)]
    assert simplify(line, 5.0) == [line[0], line[-1]]
    corner = [*line, LatLon(41.0, line[-1].lon)]
    out = simplify(corner, 5.0)
    assert out == [line[0], line[-1], corner[-1]]
    assert simplify(line[:2], 5.0) == line[:2]


def test_simplify_keeps_points_within_tolerance() -> None:
    zigzag = [LatLon(40.0 + (0.01 if i % 2 else 0.0), -105.0 + i * 0.05) for i in range(40)]
    out = simplify(zigzag, 200.0)
    for p in zigzag:
        best = min(point_segment_distance_m(p, a, b) for a, b in itertools.pairwise(out))
        assert best <= 200.0 + 1.0


def test_polyline_index_within_and_distance() -> None:
    line = [LatLon(40.0, -105.0 + i * 0.01) for i in range(101)]
    index = PolylineIndex([line], 300.0)
    assert index.within(LatLon(40.002, -104.5), 300.0)  # ~222 m north
    assert not index.within(LatLon(40.003, -104.5), 300.0)  # ~334 m north
    assert index.distance_m(LatLon(40.0, -104.5)) == pytest.approx(0.0, abs=1e-6)
    assert index.distance_m(LatLon(42.0, -104.5)) == math.inf


def test_polyline_index_matches_brute_force() -> None:
    line = [LatLon(45.0 + 0.003 * i, -110.0 + 0.004 * (i % 7)) for i in range(200)]
    index = PolylineIndex([line], 1000.0)
    for k in range(60):
        p = LatLon(45.0 + 0.01 * k, -110.0 + 0.005 * ((k * 7) % 11) - 0.01)
        brute = min(point_segment_distance_m(p, a, b) for a, b in itertools.pairwise(line))
        expected = brute if brute <= 1000.0 else math.inf
        assert index.distance_m(p) == pytest.approx(expected)


def test_polyline_index_single_point_and_validation() -> None:
    index = PolylineIndex([[LatLon(40.0, -105.0)]], 500.0)
    assert index.within(LatLon(40.001, -105.0), 500.0)
    with pytest.raises(ValueError, match="radius_m"):
        index.within(LatLon(40.0, -105.0), 501.0)
    with pytest.raises(ValueError, match="cell_m"):
        PolylineIndex([], 0.0)
