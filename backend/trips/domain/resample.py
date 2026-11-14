"""Route geometry normalization and fixed-interval resampling (PLAN §5.2).

Marks are at ``0, I, 2I, …`` (each strictly below the route length ``L``) plus ``L`` itself.
Mark ``n`` is computed as ``n x I`` (never by repeated addition) so there is no float drift.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Sequence

from trips.domain.geometry import METERS_PER_MILE, cumulative_m, lerp
from trips.domain.types import CheckpointKind, LatLon, ProgressEntry, RouteGeom, Sample


def route_geom(
    points: Sequence[LatLon],
    length_m: float,
    duration_s: float,
    progress: Sequence[ProgressEntry],
) -> RouteGeom:
    """Build a ``RouteGeom`` whose cumulative distance is scaled to the provider's length.

    The haversine sum differs from TomTom's ``lengthInMeters`` by well under 1%; scaling by
    ``length_m / raw[-1]`` makes mileage match the provider total exactly.
    """
    if len(points) < 2:
        raise ValueError("a route needs at least two points")
    if length_m <= 0:
        raise ValueError("length_m must be positive")
    raw = cumulative_m(points)
    total = raw[-1]
    if total <= 0:
        raise ValueError("route polyline has zero length")
    scale = length_m / total
    cum = [d * scale for d in raw]
    cum[-1] = float(length_m)
    return RouteGeom(
        points=tuple(points),
        cum_m=tuple(cum),
        length_m=float(length_m),
        duration_s=float(duration_s),
        progress=tuple(progress),
    )


def mark_distances_m(length_m: float, interval_mi: float) -> list[float]:
    """Mark distances in meters: ``0, I, 2I, … < L`` plus ``L``."""
    if length_m <= 0:
        raise ValueError("length_m must be positive")
    if interval_mi <= 0:
        raise ValueError("interval_mi must be positive")
    step_m = interval_mi * METERS_PER_MILE
    marks: list[float] = []
    n = 0
    while (d := n * step_m) < length_m:
        marks.append(d)
        n += 1
    marks.append(float(length_m))
    return marks


def position_at(geom: RouteGeom, distance_m: float) -> LatLon:
    """Point on the polyline at ``distance_m`` from the origin (clamped to the route)."""
    cum = geom.cum_m
    if distance_m <= 0:
        return geom.points[0]
    if distance_m >= cum[-1]:
        return geom.points[-1]
    i = bisect_right(cum, distance_m) - 1
    seg = cum[i + 1] - cum[i]
    frac = 0.0 if seg <= 0 else (distance_m - cum[i]) / seg
    return lerp(geom.points[i], geom.points[i + 1], frac)


def resample(geom: RouteGeom, interval_mi: float) -> list[Sample]:
    marks = mark_distances_m(geom.length_m, interval_mi)
    last = len(marks) - 1
    out: list[Sample] = []
    for k, d in enumerate(marks):
        kind: CheckpointKind = "origin" if k == 0 else "destination" if k == last else "interval"
        out.append(
            Sample(distance_m=d, mile=d / METERS_PER_MILE, pos=position_at(geom, d), kind=kind)
        )
    return out
