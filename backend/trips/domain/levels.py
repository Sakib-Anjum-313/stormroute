"""Risk levels as an ordered enum (see the risk-rules skill, section 1).

The integer value of each member is its numeric score, so ``max()`` over levels gives the
overall level and ``int(level)`` gives the score used by the average-risk metric.
``NO_DATA`` is deliberately not a level: it is a checkpoint status (see ``risk.Assessment``).
"""

from __future__ import annotations

from enum import IntEnum


class Level(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return _LABELS[self]

    @property
    def score(self) -> int:
        return int(self)


_LABELS: dict[Level, str] = {
    Level.LOW: "Low",
    Level.MODERATE: "Moderate",
    Level.HIGH: "High",
    Level.SEVERE: "Severe",
    Level.NO_TRAVEL: "No Travel",
}
