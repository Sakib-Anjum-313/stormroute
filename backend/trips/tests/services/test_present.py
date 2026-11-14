from __future__ import annotations

import pytest

from trips.api.present import display_value, iso_utc
from trips.domain.risk import RAIN_EDGES_IN_HR, SNOW_EDGES_IN_HR, WIND_EDGES_MPH


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (34.96, 34.9),  # 35.0 would read as High while the level is Moderate
        (34.94, 34.9),
        (35.0, 35.0),
        (35.04, 35.0),
        (24.95, 24.9),
        (54.99, 54.9),
        (12.345, 12.3),
        (None, None),
        (float("nan"), None),
    ],
)
def test_wind_display_never_crosses_a_band(value: float | None, expected: float | None) -> None:
    assert display_value(value, 1, WIND_EDGES_MPH, top_closed=False) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1.0004, 1.001),  # > 1.00 is No Travel; "1.0" would read as Severe
        (1.0, 1.0),
        (0.0996, 0.099),  # Low; "0.1" would read as Moderate
        (0.1, 0.1),
        (0.2504, 0.25),
        (0.0, 0.0),
    ],
)
def test_rain_display_never_crosses_a_band(value: float, expected: float) -> None:
    assert display_value(value, 3, RAIN_EDGES_IN_HR, top_closed=True) == expected


def test_snow_display_keeps_the_closed_top_edge() -> None:
    assert display_value(3.0004, 3, SNOW_EDGES_IN_HR, top_closed=True) == 3.001
    assert display_value(3.0, 3, SNOW_EDGES_IN_HR, top_closed=True) == 3.0


def test_iso_utc() -> None:
    assert iso_utc(1_794_643_200.4) == "2026-11-14T08:00:00Z"
