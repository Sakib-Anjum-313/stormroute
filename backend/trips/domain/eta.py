"""Driving time along a route from TomTom's sparse ``progress[]`` entries (PLAN §5.3).

Progress entries give cumulative travel time at some vertices (4-130 km apart). Each entry
becomes an anchor ``(cum_m[point_index], travel_time_s)`` on our normalized distance axis, and
driving time anywhere is interpolated linearly by distance between bracketing anchors, which
is the method TomTom's docs prescribe. Speed is assumed constant inside a gap.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass

from trips.domain.types import RouteGeom


@dataclass(frozen=True, slots=True)
class TimeAnchors:
    distance_m: tuple[float, ...]
    driving_s: tuple[float, ...]


def time_anchors(geom: RouteGeom) -> TimeAnchors:
    """Anchors from the progress entries, guaranteed to start at (0, 0) and end at the arrival.

    Entries must be in route order. A missing first or last entry is filled in from the
    origin (0 s) and the route summary duration.
    """
    last_index = len(geom.points) - 1
    dist: list[float] = [0.0]
    time: list[float] = [0.0]
    for entry in sorted(geom.progress, key=lambda e: e.point_index):
        if not 0 <= entry.point_index <= last_index:
            raise ValueError(f"progress pointIndex {entry.point_index} is outside the polyline")
        if entry.point_index == 0:
            continue
        d = geom.cum_m[entry.point_index]
        t = float(entry.travel_time_s)
        if t < time[-1]:
            raise ValueError("progress travel times must be non-decreasing")
        dist.append(d)
        time.append(t)
    if dist[-1] < geom.cum_m[-1]:
        dist.append(geom.cum_m[-1])
        time.append(max(time[-1], geom.duration_s))
    return TimeAnchors(distance_m=tuple(dist), driving_s=tuple(time))


def driving_s_at(anchors: TimeAnchors, distance_m: float) -> float:
    """Cumulative driving seconds at ``distance_m`` (clamped to the route)."""
    dist, time = anchors.distance_m, anchors.driving_s
    if distance_m <= dist[0]:
        return time[0]
    if distance_m >= dist[-1]:
        return time[-1]
    i = bisect_right(dist, distance_m) - 1
    gap = dist[i + 1] - dist[i]
    frac = (distance_m - dist[i]) / gap  # gap > 0: bisect_right skips zero-length anchor pairs
    return time[i] + (time[i + 1] - time[i]) * frac


def vertex_times_s(geom: RouteGeom, anchors: TimeAnchors | None = None) -> list[float]:
    """Cumulative driving seconds at every polyline vertex."""
    anchors = anchors or time_anchors(geom)
    return [driving_s_at(anchors, d) for d in geom.cum_m]
