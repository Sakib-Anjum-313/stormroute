"""Hours-of-service stops (49 CFR §395.3), optional and off by default (PLAN §2.1 S9).

Simplified model with fresh clocks at departure:
- a 30-minute break once 8 hours of driving accumulate without a break;
- a 10-hour off-duty rest once 11 hours of driving accumulate in the shift, which also
  resets the break clock.
The 14-hour window and the 60/70-hour rules are ignored (README "known limitations").
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

HOUR_S = 3600
BREAK_AFTER_DRIVING_S = 8 * HOUR_S
BREAK_S = 30 * 60
REST_AFTER_DRIVING_S = 11 * HOUR_S
REST_S = 10 * HOUR_S

StopKind = Literal["break", "rest"]


@dataclass(frozen=True, slots=True)
class Stop:
    at_driving_s: float
    """Cumulative driving time at which the stop starts."""
    duration_s: float
    kind: StopKind


def plan_stops(total_driving_s: float) -> list[Stop]:
    """Stops needed to drive ``total_driving_s``. No stop is placed at or after arrival."""
    stops: list[Stop] = []
    t = 0.0
    since_break = 0.0
    shift = 0.0
    while True:
        next_break = t + (BREAK_AFTER_DRIVING_S - since_break)
        next_rest = t + (REST_AFTER_DRIVING_S - shift)
        if min(next_break, next_rest) >= total_driving_s:
            return stops
        if next_rest <= next_break:
            shift += next_rest - t
            t = next_rest
            stops.append(Stop(t, REST_S, "rest"))
            since_break = shift = 0.0
        else:
            shift += next_break - t
            t = next_break
            stops.append(Stop(t, BREAK_S, "break"))
            since_break = 0.0


def stop_time_before_s(stops: Sequence[Stop], driving_s: float) -> float:
    """Total stop time taken before reaching ``driving_s``.

    A point reached exactly when a stop starts is reached before that stop.
    """
    return sum(s.duration_s for s in stops if s.at_driving_s < driving_s)


def total_stop_s(stops: Sequence[Stop]) -> float:
    return sum(s.duration_s for s in stops)
