"""Risk classification: the 25 canonical cases from the risk-rules skill, plus band edges."""

from __future__ import annotations

import math

import pytest

from trips.domain.levels import Level
from trips.domain.risk import (
    NO_DATA,
    RAIN_EDGES_IN_HR,
    RULE_LOAD_35_44_OVER_40K,
    RULE_LOAD_45_54_OVER_30K,
    RULE_RAIN_BAND,
    RULE_SNOW_BAND,
    RULE_WIND_55_ANY_LOAD,
    RULE_WIND_BAND,
    SNOW_EDGES_IN_HR,
    WIND_EDGES_MPH,
    assess,
    band_level,
)
from trips.domain.types import Weather

L, M, H, S, NT = Level.LOW, Level.MODERATE, Level.HIGH, Level.SEVERE, Level.NO_TRAVEL
ANY_WEIGHT = 20_000.0


def wx(wind: float | None = 0.0, rain: float | None = 0.0, snow: float | None = 0.0) -> Weather:
    return Weather(wind_mph=wind, gust_mph=None, rain_in_hr=rain, snow_in_hr=snow)


# (case #, wind mph, rain in/hr, snow in/hr, weight lb, expected level)
CANONICAL: list[tuple[int, float, float, float, float, Level]] = [
    (1, 24.99, 0, 0, 10_000, L),
    (2, 25.0, 0, 0, 10_000, M),
    (3, 34.6, 0, 0, 10_000, M),
    (4, 35.0, 0, 0, 40_000, H),
    (5, 35.0, 0, 0, 40_001, S),
    (6, 44.99, 0, 0, 80_000, S),
    (7, 45.0, 0, 0, 30_000, S),
    (8, 45.0, 0, 0, 30_001, NT),
    (9, 54.99, 0, 0, 5_000, S),
    (10, 55.0, 0, 0, 1, NT),
    (11, 0, 0.0999, 0, ANY_WEIGHT, L),
    (12, 0, 0.10, 0, ANY_WEIGHT, M),
    (13, 0, 0.25, 0, ANY_WEIGHT, H),
    (14, 0, 0.50, 0, ANY_WEIGHT, S),
    (15, 0, 1.00, 0, ANY_WEIGHT, S),
    (16, 0, 1.0001, 0, ANY_WEIGHT, NT),
    (17, 0, 0, 0.49, ANY_WEIGHT, L),
    (18, 0, 0, 0.5, ANY_WEIGHT, M),
    (19, 0, 0, 1.0, ANY_WEIGHT, H),
    (20, 0, 0, 2.0, ANY_WEIGHT, S),
    (21, 0, 0, 3.0, ANY_WEIGHT, S),
    (22, 0, 0, 3.01, ANY_WEIGHT, NT),
    (23, 10, 0.30, 0.6, 20_000, H),
    (24, 36, 0.12, 0, 45_000, S),
]


@pytest.mark.parametrize(
    ("case", "wind", "rain", "snow", "weight", "expected"),
    CANONICAL,
    ids=[f"case{c[0]}" for c in CANONICAL],
)
def test_canonical_cases(
    case: int, wind: float, rain: float, snow: float, weight: float, expected: Level
) -> None:
    result = assess(wx(wind, rain, snow), weight)
    assert result.status == "ok"
    assert result.level is expected


def test_canonical_case_25_nan_wind_is_no_data_not_low() -> None:
    result = assess(wx(math.nan, 0, 0), 20_000)
    assert result.status == "no_data"
    assert result.level is None
    assert result.score is None
    assert result.levels is None


EPS = 1e-9

# (variable, value, expected) for edge - eps, edge, edge + eps on every boundary.
EDGE_CASES: list[tuple[str, float, Level]] = []
for name, edges, top_closed in (
    ("wind", WIND_EDGES_MPH, False),
    ("rain", RAIN_EDGES_IN_HR, True),
    ("snow", SNOW_EDGES_IN_HR, True),
):
    for i, edge in enumerate(edges):
        below, above = Level(i), Level(i + 1)
        closed_top = top_closed and i == len(edges) - 1
        EDGE_CASES += [
            (name, edge - EPS, below),
            (name, edge, below if closed_top else above),
            (name, edge + EPS, above),
        ]


@pytest.mark.parametrize(
    ("variable", "value", "expected"), EDGE_CASES, ids=[f"{v}={x!r}" for v, x, _ in EDGE_CASES]
)
def test_every_band_boundary(variable: str, value: float, expected: Level) -> None:
    weather = wx(**{variable: value})
    # Light load so no load rule interferes with the raw wind band.
    result = assess(weather, 1.0)
    assert result.level is expected
    assert result.levels is not None
    assert getattr(result.levels, variable) is expected


@pytest.mark.parametrize(("value", "expected"), [(0.0, L), (1e9, NT)], ids=["zero", "huge"])
def test_band_extremes(value: float, expected: Level) -> None:
    assert band_level(value, WIND_EDGES_MPH, top_closed=False) is expected


@pytest.mark.parametrize(
    "weather",
    [
        None,
        wx(wind=None),
        wx(rain=None),
        wx(snow=None),
        wx(rain=math.nan),
        wx(snow=math.inf),
    ],
    ids=["no-weather", "wind-none", "rain-none", "snow-none", "rain-nan", "snow-inf"],
)
def test_missing_or_non_finite_data_is_no_data(weather: Weather | None) -> None:
    assert assess(weather, 20_000) == NO_DATA


def test_gusts_are_never_scored() -> None:
    weather = Weather(wind_mph=5.0, gust_mph=120.0, rain_in_hr=0.0, snow_in_hr=0.0)
    result = assess(weather, 80_000)
    assert result.level is L
    assert result.triggers == ()


def test_calm_weather_has_no_triggers() -> None:
    assert assess(wx(), 80_000).triggers == ()


def test_load_rule_2_trigger_explains_no_travel() -> None:
    result = assess(wx(wind=47.2), 45_000)
    assert result.level is NT
    rules = [t.rule for t in result.triggers]
    assert rules == [RULE_WIND_BAND, RULE_LOAD_45_54_OVER_30K]
    assert result.triggers[0].detail == "wind 47.2 mph in [45, 55) → Severe"
    assert result.triggers[1].detail == "wind 47.2 mph with 45,000 lb > 30,000 lb → No Travel"


def test_load_rule_3_trigger_explains_severe() -> None:
    result = assess(wx(wind=36.0), 45_000)
    assert [t.rule for t in result.triggers] == [RULE_WIND_BAND, RULE_LOAD_35_44_OVER_40K]
    assert result.triggers[1].detail == "wind 36 mph with 45,000 lb > 40,000 lb → Severe"
    assert result.levels is not None
    assert result.levels.wind is S


def test_rule_1_trigger_replaces_band_trigger() -> None:
    result = assess(wx(wind=57.5), 1)
    assert [t.rule for t in result.triggers] == [RULE_WIND_55_ANY_LOAD]
    assert result.triggers[0].detail == "wind 57.5 mph ≥ 55 → No Travel for any load"


def test_band_detail_does_not_round_onto_a_boundary() -> None:
    result = assess(wx(wind=34.99), 1)
    assert result.triggers[0].detail == "wind 34.99 mph in [25, 35) → Moderate"


def test_precipitation_triggers_show_closed_severe_band_and_strict_no_travel() -> None:
    severe = assess(wx(rain=1.0, snow=3.0), 1)
    assert [t.rule for t in severe.triggers] == [RULE_RAIN_BAND, RULE_SNOW_BAND]
    assert severe.triggers[0].detail == "rain 1 in/hr in [0.5, 1] → Severe"
    assert severe.triggers[1].detail == "snow 3 in/hr in [2, 3] → Severe"
    nt = assess(wx(rain=1.2, snow=3.01), 1)
    assert nt.triggers[0].detail == "rain 1.2 in/hr > 1 → No Travel"
    assert nt.triggers[1].detail == "snow 3.01 in/hr > 3 → No Travel"


def test_zero_value_formats_as_zero() -> None:
    from trips.domain.risk import _num

    assert _num(0.0) == "0"
    assert _num(0.00001) == "0"


def test_max_across_conditions_reports_each_variable() -> None:
    result = assess(wx(wind=10, rain=0.30, snow=0.6), 20_000)
    assert result.levels is not None
    assert (result.levels.wind, result.levels.rain, result.levels.snow) == (L, H, M)
    assert result.level is H
    assert result.score == 2


def test_levels_are_ordered_scored_and_labeled() -> None:
    assert [int(level) for level in Level] == [0, 1, 2, 3, 4]
    assert max(L, NT, M) is NT
    assert NT.score == 4
    assert [level.label for level in Level] == ["Low", "Moderate", "High", "Severe", "No Travel"]
