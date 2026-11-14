"""Spherical geometry helpers: haversine, interpolation, snapping, simplification, proximity.

Local distances use an equirectangular projection centered on the query point. That is
accurate to well under 1% at the sub-100 km scales used here. Routes are assumed not to cross
the antimeridian (the app geocodes only in the US, Canada and Mexico).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from itertools import pairwise

from trips.domain.types import Cell, LatLon

EARTH_RADIUS_M = 6_371_008.8
"""IUGG mean Earth radius."""
METERS_PER_MILE = 1609.344
METERS_PER_DEGREE = EARTH_RADIUS_M * math.pi / 180.0


def haversine_m(a: LatLon, b: LatLon) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def cumulative_m(points: Sequence[LatLon]) -> list[float]:
    """Cumulative haversine distance along ``points``; ``out[0] == 0``."""
    out = [0.0] * len(points)
    for i in range(1, len(points)):
        out[i] = out[i - 1] + haversine_m(points[i - 1], points[i])
    return out


def lerp(a: LatLon, b: LatLon, frac: float) -> LatLon:
    return LatLon(a.lat + (b.lat - a.lat) * frac, a.lon + (b.lon - a.lon) * frac)


def snap(p: LatLon, deg: float = 0.1) -> Cell:
    """Snap to the lattice of multiples of ``deg`` (a multiple of 0.1°), rounded to 0.1°."""
    # ``+ 0.0`` turns -0.0 into 0.0 so cells serialize and compare uniformly.
    return (round(round(p.lat / deg) * deg, 1) + 0.0, round(round(p.lon / deg) * deg, 1) + 0.0)


def _local_xy(p: LatLon, origin: LatLon, cos_lat: float) -> tuple[float, float]:
    return (
        (p.lon - origin.lon) * cos_lat * METERS_PER_DEGREE,
        (p.lat - origin.lat) * METERS_PER_DEGREE,
    )


def _seg_dist_sq(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    len_sq = dx * dx + dy * dy
    t = 0.0 if len_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    ex, ey = ax + t * dx - px, ay + t * dy - py
    return ex * ex + ey * ey


def point_segment_distance_m(p: LatLon, a: LatLon, b: LatLon) -> float:
    """Distance from ``p`` to segment ``ab`` in a local projection centered on ``p``."""
    cos_lat = math.cos(math.radians(p.lat))
    ax, ay = _local_xy(a, p, cos_lat)
    bx, by = _local_xy(b, p, cos_lat)
    return math.sqrt(_seg_dist_sq(0.0, 0.0, ax, ay, bx, by))


def simplify(points: Sequence[LatLon], tolerance_m: float) -> list[LatLon]:
    """Douglas-Peucker simplification (iterative). Keeps the first and last points.

    Points are projected once with an equirectangular projection at the mean latitude,
    which is adequate for choosing which vertices to keep at tolerances of tens of meters.
    """
    n = len(points)
    if n <= 2:
        return list(points)
    mean_lat = sum(p.lat for p in points) / n
    cos_lat = math.cos(math.radians(mean_lat))
    origin = points[0]
    xy = [_local_xy(p, origin, cos_lat) for p in points]
    keep = [False] * n
    keep[0] = keep[-1] = True
    tol_sq = tolerance_m * tolerance_m
    stack = [(0, n - 1)]
    while stack:
        lo, hi = stack.pop()
        ax, ay = xy[lo]
        bx, by = xy[hi]
        best_i, best_d = -1, tol_sq
        for i in range(lo + 1, hi):
            px, py = xy[i]
            d = _seg_dist_sq(px, py, ax, ay, bx, by)
            if d > best_d:
                best_i, best_d = i, d
        if best_i >= 0:
            keep[best_i] = True
            stack.append((lo, best_i))
            stack.append((best_i, hi))
    return [p for p, k in zip(points, keep, strict=True) if k]


class PolylineIndex:
    """Grid index over a set of polylines for fast "is this point within r of a route?" tests.

    Segments are bucketed by the grid cells their bounding box touches. Cells are at least
    ``cell_m`` wide everywhere in the indexed area, so any point within ``cell_m`` of a
    segment lies in one of the 3x3 cells around the point's own cell.
    """

    def __init__(self, polylines: Sequence[Sequence[LatLon]], cell_m: float) -> None:
        if cell_m <= 0:
            raise ValueError("cell_m must be positive")
        self.cell_m = cell_m
        self._segments: list[tuple[LatLon, LatLon]] = []
        max_abs_lat = max((abs(p.lat) for line in polylines for p in line), default=0.0)
        # Margin so query points slightly poleward of the routes still get wide-enough cells.
        cos_ref = max(0.01, math.cos(math.radians(min(89.0, max_abs_lat + 1.0))))
        self._dlat = cell_m / METERS_PER_DEGREE
        self._dlon = cell_m / (METERS_PER_DEGREE * cos_ref)
        self._grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for line in polylines:
            if len(line) == 1:
                line = [line[0], line[0]]
            for a, b in pairwise(line):
                seg = len(self._segments)
                self._segments.append((a, b))
                i0, i1 = sorted((self._row(a.lat), self._row(b.lat)))
                j0, j1 = sorted((self._col(a.lon), self._col(b.lon)))
                for i in range(i0, i1 + 1):
                    for j in range(j0, j1 + 1):
                        self._grid[(i, j)].append(seg)

    def _row(self, lat: float) -> int:
        return math.floor(lat / self._dlat)

    def _col(self, lon: float) -> int:
        return math.floor(lon / self._dlon)

    def distance_m(self, p: LatLon) -> float:
        """Distance to the nearest indexed segment, or ``inf`` if none is within ``cell_m``."""
        row, col = self._row(p.lat), self._col(p.lon)
        seen: set[int] = set()
        best = math.inf
        for i in range(row - 1, row + 2):
            for j in range(col - 1, col + 2):
                for seg in self._grid.get((i, j), ()):
                    if seg in seen:
                        continue
                    seen.add(seg)
                    a, b = self._segments[seg]
                    best = min(best, point_segment_distance_m(p, a, b))
        return best if best <= self.cell_m else math.inf

    def within(self, p: LatLon, radius_m: float) -> bool:
        if radius_m > self.cell_m:
            raise ValueError("radius_m must not exceed the index cell size")
        return self.distance_m(p) <= radius_m
