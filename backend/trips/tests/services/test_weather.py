from __future__ import annotations

import time
from typing import Any

import httpx
import pytest
import respx
from django.core.cache import cache

from trips.services.errors import UpstreamUnavailableError
from trips.services.openmeteo import (
    BatchProgress,
    OpenMeteoClient,
    WeatherResult,
    hour_param,
    parse_batch,
)
from trips.services.ratelimit import TokenBucket
from trips.services.weather import forecast_end_utc, unique_cells, weather_window

H = 3600
T0 = 1_794_643_200  # 2026-11-14T08:00:00Z


@pytest.mark.parametrize(
    ("departure", "last_eta", "expected"),
    [
        # Short trip: the 48 h heatmap sets the end.
        (T0 + 1800, T0 + 8 * H, (T0 - H, T0 + 49 * H)),
        # Long trip: the last ETA (rounded up) sets the end.
        (T0, T0 + 60 * H + 1, (T0 - H, T0 + 62 * H)),
        # Departure on the hour.
        (T0, T0 + 10 * H, (T0 - H, T0 + 49 * H)),
    ],
)
def test_weather_window(departure: float, last_eta: float, expected: tuple[int, int]) -> None:
    assert weather_window(departure, last_eta, now_utc=T0) == expected


def test_weather_window_is_clamped_to_the_forecast_horizon() -> None:
    now = T0
    departure = now + 7 * 24 * H
    start, end = weather_window(departure, departure + 10 * 24 * H, now)
    assert start == departure - H
    assert end == forecast_end_utc(now) == now + 16 * 24 * H - H


def test_unique_cells_preserves_first_seen_order() -> None:
    assert unique_cells([[(1.0, 2.0), (1.1, 2.0)], [(1.0, 2.0), (3.0, 4.0)]]) == [
        (1.0, 2.0),
        (1.1, 2.0),
        (3.0, 4.0),
    ]


def item(n: int = 3, start: int = T0, **overrides: Any) -> dict[str, Any]:
    hourly: dict[str, Any] = {"time": [start + i * H for i in range(n)]}
    for name in ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall"):
        hourly[name] = [1.0] * n
    hourly.update(overrides)
    return {"hourly": hourly}


def test_single_location_object_is_accepted() -> None:
    (series,) = parse_batch(item(), expected=1)
    assert series.wind_mph.start_utc == T0
    assert series.snow_in_hr.values == (1.0, 1.0, 1.0)


@pytest.mark.parametrize(
    "bad",
    [
        [item(), item()],  # wrong count
        [item(time=[T0, T0 + 2 * H, T0 + 3 * H])],  # gap in hours
        [item(start=T0 + 60)],  # not hour-aligned
        [item(rain=[1.0])],  # short array
        [item(time=[])],
        [{"hourly": {}}],
    ],
)
def test_malformed_batches_are_rejected(bad: Any) -> None:
    with pytest.raises((ValueError, KeyError)):
        parse_batch(bad, expected=1)


def test_null_hours_are_kept_as_missing() -> None:
    (series,) = parse_batch([item(snowfall=[None, 0.2, None])], expected=1)
    assert series.snow_in_hr.values == (None, 0.2, None)


def drain(gen: Any) -> tuple[list[BatchProgress], WeatherResult]:
    progress = []
    while True:
        try:
            progress.append(next(gen))
        except StopIteration as stop:
            return progress, stop.value


def test_fetch_uses_the_cache_on_the_second_call(settings: Any) -> None:
    settings.UPSTREAM_RETRY_DELAYS_S = ()
    cache.clear()
    cells = [(40.0 + i / 10, -105.0) for i in range(150)]
    client = OpenMeteoClient(bucket=TokenBucket(500))

    def answer(request: httpx.Request) -> httpx.Response:
        n = request.content.decode().split("latitude=")[1].split("&")[0].count("%2C") + 1
        return httpx.Response(200, json=[item(n=50, start=T0 - H)] * n)

    with respx.mock() as router:
        route = router.post("https://api.open-meteo.com/v1/forecast").mock(side_effect=answer)
        progress, first = drain(
            client.fetch(cells, T0 - H, T0 + 48 * H, deadline=time.monotonic() + 60)
        )
        _, second = drain(client.fetch(cells, T0 - H, T0 + 48 * H, deadline=time.monotonic() + 60))

    assert route.call_count == 2  # 150 cells = 100 + 50
    assert progress == [BatchProgress(0, 2), BatchProgress(1, 2), BatchProgress(2, 2)]
    assert (first.fetched, first.cached, second.fetched, second.cached) == (150, 0, 0, 150)
    assert set(second.series) == set(cells)
    cache.clear()


def test_fetch_fails_when_every_batch_fails(settings: Any) -> None:
    settings.UPSTREAM_RETRY_DELAYS_S = ()
    cache.clear()
    client = OpenMeteoClient(bucket=TokenBucket(500))
    with respx.mock() as router:
        router.post("https://api.open-meteo.com/v1/forecast").mock(
            return_value=httpx.Response(400, json={"error": True, "reason": "bad"})
        )
        with pytest.raises(UpstreamUnavailableError):
            drain(client.fetch([(40.0, -105.0)], T0, T0 + H, deadline=time.monotonic() + 60))


def test_hour_param_is_gmt_minutes() -> None:
    assert hour_param(T0) == "2026-11-14T08:00"
