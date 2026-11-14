"""Weather at the truck's ETA (risk-rules skill, section 4).

- Wind is instantaneous at each hour mark: linear interpolation between the two hours that
  bracket ``t``; exactly on the hour uses that hour's value.
- Rain, showers, snow and gusts are preceding-hour aggregates: the value labeled ``H`` covers
  ``(H - 1h, H]``, so ``t`` uses label ``ceil_hour(t)`` (an exact hour ``H`` uses ``H``).

The heatmap uses these same functions at ``T0 + k h`` so it can never disagree with checkpoints.
"""

from __future__ import annotations

import math

from trips.domain.types import HourlySeries, LocationSeries, Weather

HOUR_S = 3600


def floor_hour(t_utc: float) -> int:
    return math.floor(t_utc / HOUR_S) * HOUR_S


def ceil_hour(t_utc: float) -> int:
    return math.ceil(t_utc / HOUR_S) * HOUR_S


def _value_at_label(series: HourlySeries, label_utc: int) -> float | None:
    offset = label_utc - series.start_utc
    if offset % HOUR_S:
        raise ValueError("series start_utc must be hour-aligned")
    idx = offset // HOUR_S
    if idx < 0 or idx >= len(series.values):
        return None
    value = series.values[idx]
    if value is None or not math.isfinite(value):
        return None
    return value


def wind_at(series: HourlySeries, t_utc: float) -> float | None:
    """Linearly interpolated instantaneous value at ``t_utc``; ``None`` if a bracket is missing."""
    h0 = floor_hour(t_utc)
    v0 = _value_at_label(series, h0)
    if v0 is None:
        return None
    frac = (t_utc - h0) / HOUR_S
    if frac == 0:
        return v0
    v1 = _value_at_label(series, h0 + HOUR_S)
    if v1 is None:
        return None
    return v0 + (v1 - v0) * frac


def precip_at(series: HourlySeries, t_utc: float) -> float | None:
    """Preceding-hour bucket containing ``t_utc`` (label ``ceil_hour(t_utc)``)."""
    return _value_at_label(series, ceil_hour(t_utc))


def weather_at(series: LocationSeries, t_utc: float) -> Weather:
    """Weather at one instant. Rain is ``rain + showers``; a missing part makes it ``None``."""
    rain = precip_at(series.rain_in_hr, t_utc)
    showers = precip_at(series.showers_in_hr, t_utc)
    return Weather(
        wind_mph=wind_at(series.wind_mph, t_utc),
        gust_mph=precip_at(series.gust_mph, t_utc),
        rain_in_hr=None if rain is None or showers is None else rain + showers,
        snow_in_hr=precip_at(series.snow_in_hr, t_utc),
    )
