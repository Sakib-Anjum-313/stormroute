"""Route dedupe and selection of the 3 routes to show (PLAN §2.1 S10, §5.8).

Two routes are "the same" when at least 85% of the shorter route's 1-mile samples lie within
300 m of the other route. From the distinct routes in provider order, keep A (index 0, the
provider's primary) plus the two that maximize the minimum pairwise difference, where
``difference = 1 - overlap`` and overlap is measured on the shorter route's samples.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations

from trips.domain.geometry import PolylineIndex
from trips.domain.resample import resample
from trips.domain.types import LatLon, RouteGeom

SAME_ROUTE_MIN_OVERLAP = 0.85
NEAR_M = 300.0
SAMPLE_INTERVAL_MI = 1.0


@dataclass(frozen=True, slots=True)
class Selection:
    kept: tuple[int, ...]
    """Indices into the input, in provider order."""
    duplicate_of: dict[int, int]
    """Dropped duplicates mapped to the earlier route they duplicate."""


class _Route:
    def __init__(self, geom: RouteGeom) -> None:
        self.length_m = geom.length_m
        self.samples: list[LatLon] = [s.pos for s in resample(geom, SAMPLE_INTERVAL_MI)]
        self.index = PolylineIndex([geom.points], NEAR_M)


def _fraction_near(samples: Sequence[LatLon], other: PolylineIndex) -> float:
    near = sum(1 for p in samples if other.within(p, NEAR_M))
    return near / len(samples)


def _overlap(a: _Route, b: _Route) -> float:
    shorter, longer = (a, b) if a.length_m <= b.length_m else (b, a)
    return _fraction_near(shorter.samples, longer.index)


def select_routes(geoms: Sequence[RouteGeom], keep: int = 3) -> Selection:
    if not geoms:
        return Selection(kept=(), duplicate_of={})
    routes = [_Route(g) for g in geoms]
    overlap: dict[tuple[int, int], float] = {}

    def ov(i: int, j: int) -> float:
        pair = (min(i, j), max(i, j))
        if pair not in overlap:
            overlap[pair] = _overlap(routes[pair[0]], routes[pair[1]])
        return overlap[pair]

    distinct: list[int] = []
    duplicate_of: dict[int, int] = {}
    for i in range(len(routes)):
        dup = next((j for j in distinct if ov(i, j) >= SAME_ROUTE_MIN_OVERLAP), None)
        if dup is None:
            distinct.append(i)
        else:
            duplicate_of[i] = dup

    if keep < 2:
        return Selection(kept=tuple(distinct[: max(keep, 0)]), duplicate_of=duplicate_of)
    if len(distinct) <= keep:
        return Selection(kept=tuple(distinct), duplicate_of=duplicate_of)

    first, rest = distinct[0], distinct[1:]
    best: tuple[int, ...] = ()
    best_score = -1.0
    for combo in combinations(rest, keep - 1):
        chosen = (first, *combo)
        score = min(1.0 - ov(i, j) for i, j in combinations(chosen, 2))
        if score > best_score:  # strict: ties keep the earliest combination (provider order)
            best, best_score = chosen, score
    return Selection(kept=tuple(sorted(best)), duplicate_of=duplicate_of)
