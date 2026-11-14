"""Weather-risk classification with load rules (risk-rules skill, sections 2 and 3).

Bands are half-open ``[low, high)``, so a boundary value goes to the worse band. The only
exceptions are rain and snow No Travel, where the spec says ``>``, so the top of Severe is
closed there. Values are compared raw; nothing is rounded before classifying.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from trips.domain.levels import Level
from trips.domain.types import Weather

WIND_EDGES_MPH: tuple[float, float, float, float] = (25.0, 35.0, 45.0, 55.0)
RAIN_EDGES_IN_HR: tuple[float, float, float, float] = (0.10, 0.25, 0.50, 1.00)
SNOW_EDGES_IN_HR: tuple[float, float, float, float] = (0.5, 1.0, 2.0, 3.0)

LOAD_NO_TRAVEL_OVER_LB = 30_000
"""Rule 2: wind in [45, 55) mph with weight > 30,000 lb is No Travel."""
LOAD_SEVERE_OVER_LB = 40_000
"""Rule 3: wind in [35, 45) mph with weight > 40,000 lb is Severe."""

RULE_WIND_BAND = "wind_band"
RULE_RAIN_BAND = "rain_band"
RULE_SNOW_BAND = "snow_band"
RULE_WIND_55_ANY_LOAD = "wind_55_any_load"
RULE_LOAD_45_54_OVER_30K = "load_45_54_over_30k"
RULE_LOAD_35_44_OVER_40K = "load_35_44_over_40k"

Status = Literal["ok", "no_data"]


@dataclass(frozen=True, slots=True)
class Trigger:
    rule: str
    detail: str


@dataclass(frozen=True, slots=True)
class VariableLevels:
    wind: Level
    """Wind level after the load rules."""
    rain: Level
    snow: Level


@dataclass(frozen=True, slots=True)
class Assessment:
    status: Status
    level: Level | None
    levels: VariableLevels | None
    triggers: tuple[Trigger, ...]

    @property
    def score(self) -> int | None:
        return None if self.level is None else int(self.level)


NO_DATA = Assessment(status="no_data", level=None, levels=None, triggers=())


def band_level(value: float, edges: tuple[float, ...], *, top_closed: bool) -> Level:
    """Classify ``value`` against ascending ``edges`` (lower bound inclusive).

    With ``top_closed`` the last edge uses a strict ``>``: the band below it is closed.
    """
    level = 0
    last = len(edges) - 1
    for i, edge in enumerate(edges):
        reached = value > edge if (top_closed and i == last) else value >= edge
        if not reached:
            break
        level = i + 1
    return Level(level)


def assess(weather: Weather | None, weight_lb: float) -> Assessment:
    """Classify one checkpoint or heatmap cell for the given load weight.

    Missing or non-finite wind, rain or snow gives status ``no_data``, never LOW.
    Gusts are display-only and never scored.
    """
    if weather is None:
        return NO_DATA
    wind, rain, snow = weather.wind_mph, weather.rain_in_hr, weather.snow_in_hr
    if wind is None or rain is None or snow is None:
        return NO_DATA
    if not (math.isfinite(wind) and math.isfinite(rain) and math.isfinite(snow)):
        return NO_DATA

    triggers: list[Trigger] = []

    wind_band = band_level(wind, WIND_EDGES_MPH, top_closed=False)
    wind_level = wind_band
    if wind_band is Level.NO_TRAVEL:
        triggers.append(
            Trigger(
                RULE_WIND_55_ANY_LOAD,
                _band_detail("wind", wind, "mph", WIND_EDGES_MPH, False) + " for any load",
            )
        )
    else:
        if wind_band > Level.LOW:
            triggers.append(
                Trigger(RULE_WIND_BAND, _band_detail("wind", wind, "mph", WIND_EDGES_MPH, False))
            )
        if wind_band is Level.SEVERE and weight_lb > LOAD_NO_TRAVEL_OVER_LB:
            wind_level = Level.NO_TRAVEL
            triggers.append(
                Trigger(
                    RULE_LOAD_45_54_OVER_30K,
                    f"wind {_num(wind)} mph with {_lb(weight_lb)} > "
                    f"{_lb(LOAD_NO_TRAVEL_OVER_LB)} → No Travel",
                )
            )
        elif wind_band is Level.HIGH and weight_lb > LOAD_SEVERE_OVER_LB:
            wind_level = Level.SEVERE
            triggers.append(
                Trigger(
                    RULE_LOAD_35_44_OVER_40K,
                    f"wind {_num(wind)} mph with {_lb(weight_lb)} > "
                    f"{_lb(LOAD_SEVERE_OVER_LB)} → Severe",
                )
            )

    rain_level = band_level(rain, RAIN_EDGES_IN_HR, top_closed=True)
    if rain_level > Level.LOW:
        triggers.append(
            Trigger(RULE_RAIN_BAND, _band_detail("rain", rain, "in/hr", RAIN_EDGES_IN_HR, True))
        )
    snow_level = band_level(snow, SNOW_EDGES_IN_HR, top_closed=True)
    if snow_level > Level.LOW:
        triggers.append(
            Trigger(RULE_SNOW_BAND, _band_detail("snow", snow, "in/hr", SNOW_EDGES_IN_HR, True))
        )

    return Assessment(
        status="ok",
        level=max(wind_level, rain_level, snow_level),
        levels=VariableLevels(wind=wind_level, rain=rain_level, snow=snow_level),
        triggers=tuple(triggers),
    )


def _num(value: float) -> str:
    """Format a measured value without rounding it onto a boundary (34.99 stays 34.99)."""
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text or "0"


def _lb(weight_lb: float) -> str:
    return f"{weight_lb:,.0f} lb"


def _band_detail(
    name: str, value: float, unit: str, edges: tuple[float, ...], top_closed: bool
) -> str:
    level = band_level(value, edges, top_closed=top_closed)
    idx = int(level)
    low = _num(edges[idx - 1])
    if idx == len(edges):
        op = ">" if top_closed else "≥"
        return f"{name} {_num(value)} {unit} {op} {low} → {level.label}"
    high = _num(edges[idx])
    close = "]" if (top_closed and idx == len(edges) - 1) else ")"
    return f"{name} {_num(value)} {unit} in [{low}, {high}{close} → {level.label}"
