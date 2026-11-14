from __future__ import annotations

import math

import pytest

from trips.domain.timealign import ceil_hour, floor_hour, precip_at, weather_at, wind_at
from trips.domain.types import HourlySeries, LocationSeries

T0 = 1_763_100_000 - (1_763_100_000 % 3600)  # an hour-aligned epoch in Nov 2025
HR = 3600


def series(*values: float | None, start: int = T0) -> HourlySeries:
    return HourlySeries(start_utc=start, values=values)


@pytest.mark.parametrize(
    ("t", "floor", "ceil"),
    [(T0, T0, T0), (T0 + 1, T0, T0 + HR), (T0 + HR - 1, T0, T0 + HR), (T0 - 1, T0 - HR, T0)],
)
def test_floor_and_ceil_hour(t: float, floor: int, ceil: int) -> None:
    assert floor_hour(t) == floor
    assert ceil_hour(t) == ceil


WIND = series(10.0, 20.0, None, 40.0)


@pytest.mark.parametrize(
    ("t", "expected"),
    [
        (T0, 10.0),  # exactly on the hour uses that hour's value
        (T0 + HR / 2, 15.0),  # mid-hour interpolates linearly
        (T0 + HR / 4, 12.5),
        (T0 + HR, 20.0),
        (T0 + 1.5 * HR, None),  # upper bracket missing
        (T0 + 2 * HR, None),  # on-hour missing value
        (T0 + 3 * HR, 40.0),
        (T0 + 3.5 * HR, None),  # past the end of the series
        (T0 - 1, None),  # before the start of the series
    ],
)
def test_wind_is_interpolated_between_hours(t: float, expected: float | None) -> None:
    got = wind_at(WIND, t)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)


# Value labeled H covers (H - 1h, H].
PRECIP = series(0.0, 0.1, 0.2, 0.3)


@pytest.mark.parametrize(
    ("t", "expected"),
    [
        (T0, 0.0),  # on the hour uses its own label
        (T0 + 1, 0.1),  # just after T0 belongs to the bucket labeled T0 + 1h
        (T0 + HR / 2, 0.1),
        (T0 + HR, 0.1),
        (T0 + HR + 1, 0.2),
        (T0 + 3 * HR, 0.3),
        (T0 + 3 * HR + 1, None),
    ],
)
def test_precip_uses_bucket_labeled_ceil_hour(t: float, expected: float | None) -> None:
    assert precip_at(PRECIP, t) == expected


def test_nan_values_are_missing() -> None:
    assert precip_at(series(math.nan), T0) is None


def test_unaligned_series_start_is_rejected() -> None:
    with pytest.raises(ValueError, match="hour-aligned"):
        precip_at(series(1.0, start=T0 + 60), T0 + HR)


def _location(showers: HourlySeries) -> LocationSeries:
    return LocationSeries(
        wind_mph=series(30.0, 40.0),
        gust_mph=series(50.0, 60.0),
        rain_in_hr=series(0.05, 0.08),
        showers_in_hr=showers,
        snow_in_hr=series(0.0, 0.4),
    )


def test_weather_at_sums_rain_and_showers_and_aligns_each_variable() -> None:
    w = weather_at(_location(series(0.01, 0.04)), T0 + HR / 2)
    assert w.wind_mph == pytest.approx(35.0)
    assert w.gust_mph == 60.0
    assert w.rain_in_hr == pytest.approx(0.12)
    assert w.snow_in_hr == 0.4


def test_weather_at_missing_showers_makes_rain_missing() -> None:
    w = weather_at(_location(series(0.01, None)), T0 + HR / 2)
    assert w.rain_in_hr is None
    assert w.wind_mph is not None
