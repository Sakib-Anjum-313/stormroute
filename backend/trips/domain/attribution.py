"""Mile attribution and per-route aggregates (risk-rules skill, section 5).

Checkpoint ``i`` owns ``[(m[i-1]+m[i])/2, (m[i]+m[i+1])/2]`` clipped to ``[0, L]``, so owned
miles sum to ``L``. NO_DATA miles are kept in their own bucket and excluded from the average.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from trips.domain.levels import Level
from trips.domain.risk import Assessment


def owned_miles(marks_mi: Sequence[float], length_mi: float) -> list[float]:
    """Half-interval ownership for ascending marks in ``[0, length_mi]``."""
    n = len(marks_mi)
    if n == 0:
        return []
    bounds = [0.0]
    bounds += [(marks_mi[i] + marks_mi[i + 1]) / 2 for i in range(n - 1)]
    bounds.append(float(length_mi))
    clipped = [min(length_mi, max(0.0, b)) for b in bounds]
    return [clipped[i + 1] - clipped[i] for i in range(n)]


@dataclass(frozen=True, slots=True)
class Aggregates:
    miles_by_level: dict[Level, float]
    no_data_mi: float
    avg_risk: float | None
    """Distance-weighted mean score over checkpoints with data; ``None`` if there are none."""
    max_level: Level | None
    checkpoint_count: int

    @property
    def no_travel_mi(self) -> float:
        return self.miles_by_level[Level.NO_TRAVEL]

    @property
    def severe_mi(self) -> float:
        return self.miles_by_level[Level.SEVERE]

    @property
    def high_mi(self) -> float:
        return self.miles_by_level[Level.HIGH]


def aggregate(owned_mi: Sequence[float], assessments: Sequence[Assessment]) -> Aggregates:
    if len(owned_mi) != len(assessments):
        raise ValueError("owned_mi and assessments must have the same length")
    by_level: dict[Level, list[float]] = {level: [] for level in Level}
    no_data: list[float] = []
    for miles, a in zip(owned_mi, assessments, strict=True):
        if a.level is None:
            no_data.append(miles)
        else:
            by_level[a.level].append(miles)
    miles_by_level = {level: math.fsum(v) for level, v in by_level.items()}
    data_mi = math.fsum(miles_by_level.values())
    weighted = math.fsum(int(level) * mi for level, mi in miles_by_level.items())
    levels = [a.level for a in assessments if a.level is not None]
    return Aggregates(
        miles_by_level=miles_by_level,
        no_data_mi=math.fsum(no_data),
        avg_risk=weighted / data_mi if data_mi > 0 else None,
        max_level=max(levels) if levels else None,
        checkpoint_count=len(assessments),
    )
