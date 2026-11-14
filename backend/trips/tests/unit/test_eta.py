from __future__ import annotations

import itertools
from typing import Any

import pytest

from trips.domain.checkpoints import build_checkpoints
from trips.domain.eta import distance_m_at, driving_s_at, time_anchors, vertex_times_s
from trips.domain.geometry import cumulative_m
from trips.domain.resample import route_geom
from trips.domain.types import LatLon, ProgressEntry, RouteGeom


def hand_route(progress: list[ProgressEntry], duration_s: float = 300.0) -> RouteGeom:
    # Five equally spaced vertices on the equator; normalized length = 4 km exactly.
    pts = [LatLon(0.0, 0.009 * i) for i in range(5)]
    assert cumulative_m(pts)[-1] == pytest.approx(4000, rel=0.002)
    return route_geom(pts, 4000.0, duration_s, progress)


HAND_PROGRESS = [
    ProgressEntry(0, 0, 0),
    ProgressEntry(2, 2000, 60),  # fast first half
    ProgressEntry(4, 4000, 300),  # slow second half
]


@pytest.mark.parametrize(
    ("distance_m", "expected_s"),
    [(0, 0), (500, 15), (1000, 30), (2000, 60), (3000, 180), (3500, 240), (4000, 300)],
)
def test_interpolates_progress_by_distance(distance_m: float, expected_s: float) -> None:
    anchors = time_anchors(hand_route(HAND_PROGRESS))
    assert driving_s_at(anchors, distance_m) == pytest.approx(expected_s)


def test_clamps_outside_route_and_vertex_times() -> None:
    geom = hand_route(HAND_PROGRESS)
    anchors = time_anchors(geom)
    assert driving_s_at(anchors, -10) == 0
    assert driving_s_at(anchors, 99_999) == 300
    assert vertex_times_s(geom) == pytest.approx([0, 30, 60, 180, 300])


def test_missing_final_entry_uses_summary_duration() -> None:
    geom = hand_route([ProgressEntry(2, 2000, 60)], duration_s=300)
    anchors = time_anchors(geom)
    assert anchors.distance_m[0] == 0
    assert anchors.driving_s[-1] == 300
    assert driving_s_at(anchors, 3000) == pytest.approx(180)


def test_duplicate_anchor_distances_do_not_divide_by_zero() -> None:
    progress = [*HAND_PROGRESS[:2], ProgressEntry(2, 2000, 90), HAND_PROGRESS[2]]
    anchors = time_anchors(hand_route(progress))
    assert driving_s_at(anchors, 2000) == pytest.approx(90)
    assert driving_s_at(anchors, 3000) == pytest.approx(195)


@pytest.mark.parametrize(
    ("progress", "match"),
    [
        ([ProgressEntry(9, 0, 0)], "outside the polyline"),
        ([ProgressEntry(1, 1000, 50), ProgressEntry(2, 2000, 40)], "non-decreasing"),
    ],
)
def test_invalid_progress_is_rejected(progress: list[ProgressEntry], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        time_anchors(hand_route(progress))


@pytest.mark.parametrize("route_idx", [0, 1, 2, 3])
def test_recorded_fixture_last_eta_matches_tomtom(
    denver_slc: list[RouteGeom], denver_slc_raw: dict[str, Any], route_idx: int
) -> None:
    geom = denver_slc[route_idx]
    raw = denver_slc_raw["response"]["routes"][route_idx]
    departure = 1_763_100_000.0
    for interval in (10, 25, 50):
        cps = build_checkpoints(geom, interval, departure)
        etas = [c.eta_utc for c in cps]
        assert all(b > a for a, b in itertools.pairwise(etas))
        assert cps[0].eta_utc == departure
        assert cps[-1].eta_utc - departure == pytest.approx(
            raw["summary"]["travelTimeInSeconds"], abs=1
        )


def test_recorded_fixture_anchors_hit_every_progress_entry(
    denver_slc: list[RouteGeom], denver_slc_raw: dict[str, Any]
) -> None:
    geom = denver_slc[0]
    anchors = time_anchors(geom)
    for entry in denver_slc_raw["response"]["routes"][0]["progress"]:
        d = geom.cum_m[entry["pointIndex"]]
        assert driving_s_at(anchors, d) == pytest.approx(entry["travelTimeInSeconds"], abs=1e-6)
        # Our normalized haversine axis stays close to TomTom's own distances.
        assert abs(d - entry["distanceInMeters"]) < 0.005 * geom.length_m


@pytest.mark.parametrize(
    ("driving_s", "expected_m"),
    [(-5, 0.0), (0, 0.0), (30, 1000.0), (60, 2000.0), (180, 3000.0), (300, 4000.0), (999, 4000.0)],
)
def test_distance_at_inverts_driving_time(driving_s: float, expected_m: float) -> None:
    anchors = time_anchors(hand_route(HAND_PROGRESS))
    assert distance_m_at(anchors, driving_s) == pytest.approx(expected_m)
    if 0 <= driving_s <= 300:
        assert driving_s_at(anchors, distance_m_at(anchors, driving_s)) == pytest.approx(driving_s)


def test_distance_at_skips_zero_duration_gaps() -> None:
    # A stretch with no travel time (e.g. a ferry ramp) maps to its earliest distance.
    progress = [ProgressEntry(0, 0, 0), ProgressEntry(2, 2000, 60), ProgressEntry(3, 3000, 60)]
    anchors = time_anchors(hand_route([*progress, ProgressEntry(4, 4000, 120)]))
    assert distance_m_at(anchors, 60) == pytest.approx(2000.0)
    assert distance_m_at(anchors, 90) == pytest.approx(3500.0)
