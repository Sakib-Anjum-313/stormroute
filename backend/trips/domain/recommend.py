"""Route recommendation: lexicographic comparator (risk-rules skill, section 6).

key(route) = (no_weather_data, no_travel_mi, severe_mi, high_mi, avg_risk, duration_min,
route_index), smaller is better. The spec's four steps are severe, high, average risk and
duration. Two approved additions come first:
- ``no_weather_data`` (1 if the route has no weather data at all, else 0). Missing checkpoints add
  no miles to any level, so without this gate a route whose weather failed entirely would tie at
  0 on every mileage step and beat a route with real High miles.
- ``no_travel_mi``: No Travel is strictly worse than Severe.
Rounding (0.1 mi, 0.01 score, whole minutes) only absorbs float noise.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from trips.domain.attribution import Aggregates

STEPS: Final = (
    "no_weather_data",
    "no_travel_mi",
    "severe_mi",
    "high_mi",
    "avg_risk",
    "duration_min",
)
ROUTE_ORDER: Final = "route_order"
"""Reported when two routes tie on every step and provider order decides."""

RouteKey = tuple[float, float, float, float, float, int, int]


@dataclass(frozen=True, slots=True)
class RouteScore:
    route_id: str
    index: int
    """Provider order (A = 0); the final deterministic tie-break."""
    aggregates: Aggregates
    duration_s: float
    """Travel time, including HOS stops when the toggle is on."""


@dataclass(frozen=True, slots=True)
class Recommendation:
    route_id: str
    ranking: tuple[str, ...]
    all_no_travel: bool
    keys: dict[str, RouteKey]
    decided_by: dict[str, str]
    """For every non-winning route, the first step at which it lost to the winner."""
    decisive_step: str | None
    """The step that separated the winner from the runner-up (``None`` with one route)."""


def route_key(score: RouteScore) -> RouteKey:
    agg = score.aggregates
    no_data = agg.avg_risk is None  # no checkpoint with weather data at all
    # Between two routes without data, the average step is a tie (both inf).
    avg = math.inf if agg.avg_risk is None else round(agg.avg_risk, 2)
    return (
        1.0 if no_data else 0.0,
        round(agg.no_travel_mi, 1),
        round(agg.severe_mi, 1),
        round(agg.high_mi, 1),
        avg,
        round(score.duration_s / 60),
        score.index,
    )


def _separating_step(loser: RouteKey, winner: RouteKey) -> str:
    for step, a, b in zip(STEPS, loser, winner, strict=False):
        if a != b:
            return step
    return ROUTE_ORDER


def recommend(scores: Sequence[RouteScore]) -> Recommendation:
    if not scores:
        raise ValueError("cannot recommend from zero routes")
    if len({s.route_id for s in scores}) != len(scores):
        raise ValueError("route ids must be unique")
    keyed = sorted(((route_key(s), s) for s in scores), key=lambda ks: ks[0])
    winner_key, winner = keyed[0]
    decided_by = {s.route_id: _separating_step(k, winner_key) for k, s in keyed[1:]}
    return Recommendation(
        route_id=winner.route_id,
        ranking=tuple(s.route_id for _, s in keyed),
        all_no_travel=all(s.aggregates.no_travel_mi > 0 for s in scores),
        keys={s.route_id: k for k, s in keyed},
        decided_by=decided_by,
        decisive_step=decided_by[keyed[1][1].route_id] if len(keyed) > 1 else None,
    )
