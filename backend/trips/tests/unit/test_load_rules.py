"""Load-rule grid: weights around 30k/40k lb x winds around every load-relevant edge."""

from __future__ import annotations

import pytest

from trips.domain.levels import Level
from trips.domain.risk import assess
from trips.domain.types import Weather

L, M, H, S, NT = Level.LOW, Level.MODERATE, Level.HIGH, Level.SEVERE, Level.NO_TRAVEL

WEIGHTS = (30_000, 30_001, 40_000, 40_001)
# wind mph -> expected level for each weight in WEIGHTS
GRID: dict[float, tuple[Level, Level, Level, Level]] = {
    34.99: (M, M, M, M),
    35.0: (H, H, H, S),
    44.99: (H, H, H, S),
    45.0: (S, NT, NT, NT),
    54.99: (S, NT, NT, NT),
    55.0: (NT, NT, NT, NT),
}

CASES = [
    (wind, weight, expected)
    for wind, row in GRID.items()
    for weight, expected in zip(WEIGHTS, row, strict=True)
]


@pytest.mark.parametrize(
    ("wind", "weight", "expected"), CASES, ids=[f"{w}mph-{lb}lb" for w, lb, _ in CASES]
)
def test_load_rule_grid(wind: float, weight: int, expected: Level) -> None:
    weather = Weather(wind_mph=wind, gust_mph=None, rain_in_hr=0.0, snow_in_hr=0.0)
    result = assess(weather, weight)
    assert result.level is expected
    assert result.levels is not None
    assert result.levels.wind is expected


@pytest.mark.parametrize("weight", [1, 30_000, 80_000, 200_000])
def test_load_rules_never_lower_a_level(weight: int) -> None:
    for wind in (0.0, 24.99, 25.0, 35.0, 45.0, 55.0, 80.0):
        weather = Weather(wind_mph=wind, gust_mph=None, rain_in_hr=0.0, snow_in_hr=0.0)
        light = assess(weather, 1)
        heavy = assess(weather, weight)
        assert light.level is not None
        assert heavy.level is not None
        assert heavy.level >= light.level


def test_load_rules_do_not_hide_worse_precipitation() -> None:
    weather = Weather(wind_mph=36.0, gust_mph=None, rain_in_hr=1.5, snow_in_hr=0.0)
    assert assess(weather, 45_000).level is NT
