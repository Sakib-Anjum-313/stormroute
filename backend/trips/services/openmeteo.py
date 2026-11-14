"""Open-Meteo Forecast client: batched POSTs, a location-denominated token bucket and a cache.

- Up to 100 locations per POST (a form body avoids 414s), at most 4 batches in flight per
  process, 500 locations/min through the token bucket, 60 min cache per
  ``(cell, start_hour, end_hour)``.
- 429 is retried with jittered backoff (1 s, 3 s) and then raises ``UpstreamRateLimitedError``.
- A batch that fails with a 5xx or a malformed payload leaves its cells without data (the
  planner marks them NO_DATA and warns). If every batch fails, the whole fetch fails.
"""

from __future__ import annotations

import contextlib
import contextvars
import datetime as dt
import logging
import threading
import time
from collections.abc import Generator, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Any

import httpx
from django.conf import settings
from django.core.cache import cache

from trips.domain.timealign import HOUR_S
from trips.domain.types import Cell, HourlySeries, LocationSeries
from trips.services.errors import (
    UpstreamRateLimitedError,
    UpstreamTimeoutError,
    UpstreamUnavailableError,
)
from trips.services.http import send_with_retries, shared_client
from trips.services.ratelimit import TokenBucket

log = logging.getLogger(__name__)

HOURLY_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
BATCH_SIZE = 100
MAX_IN_FLIGHT = 4
BATCH_TIMEOUT_S = 8.0
CACHE_TTL_S = 60 * 60
LOCATIONS_PER_MINUTE = 500

_bucket = TokenBucket(LOCATIONS_PER_MINUTE, 60.0)
_in_flight = threading.BoundedSemaphore(MAX_IN_FLIGHT)


@dataclass(frozen=True, slots=True)
class BatchProgress:
    done: int
    total: int


@dataclass(frozen=True, slots=True)
class WeatherResult:
    series: dict[Cell, LocationSeries]
    failed: frozenset[Cell]
    cached: int
    fetched: int


WeatherFetch = Generator[BatchProgress, None, WeatherResult]


def hour_param(t_utc: int) -> str:
    return dt.datetime.fromtimestamp(t_utc, tz=dt.UTC).strftime("%Y-%m-%dT%H:%M")


def cache_key(cell: Cell, start_utc: int, end_utc: int) -> str:
    return f"om:v1:{cell[0]:.1f},{cell[1]:.1f}:{start_utc}:{end_utc}"


def _values(raw: Any, n: int) -> tuple[float | None, ...]:
    if not isinstance(raw, list) or len(raw) != n:
        raise ValueError("hourly array has the wrong length")
    return tuple(None if v is None else float(v) for v in raw)


def parse_location(item: Any) -> LocationSeries:
    """One location's hourly block (already in mph and inches) as a ``LocationSeries``."""
    hourly = item["hourly"]
    times = hourly["time"]
    if not isinstance(times, list) or not times:
        raise ValueError("no hourly times")
    start = int(times[0])
    if start % HOUR_S or any(int(t) != start + i * HOUR_S for i, t in enumerate(times)):
        raise ValueError("hourly times are not contiguous whole hours")
    n = len(times)

    def series(name: str) -> HourlySeries:
        return HourlySeries(start_utc=start, values=_values(hourly[name], n))

    return LocationSeries(
        wind_mph=series("wind_speed_10m"),
        gust_mph=series("wind_gusts_10m"),
        rain_in_hr=series("rain"),
        showers_in_hr=series("showers"),
        snow_in_hr=series("snowfall"),
    )


def parse_batch(body: Any, expected: int) -> list[LocationSeries]:
    items = [body] if isinstance(body, dict) else body  # one location returns an object
    if not isinstance(items, list) or len(items) != expected:
        raise ValueError("location count does not match the request")
    return [parse_location(item) for item in items]


class OpenMeteoClient:
    def __init__(
        self,
        base_url: str = "https://api.open-meteo.com",
        api_key: str = "",
        http: httpx.Client | None = None,
        bucket: TokenBucket | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._http = http
        self._bucket = bucket or _bucket

    @property
    def http(self) -> httpx.Client:
        return self._http or shared_client()

    def fetch(
        self, cells: Sequence[Cell], start_utc: int, end_utc: int, *, deadline: float
    ) -> WeatherFetch:
        """Series for every cell over ``[start_utc, end_utc]`` (inclusive hours).

        A generator: it yields one ``BatchProgress`` per finished batch and returns the
        ``WeatherResult``. ``deadline`` is a ``time.monotonic()`` value for the whole fetch.
        """
        keys = {cell: cache_key(cell, start_utc, end_utc) for cell in cells}
        hits: dict[str, LocationSeries] = cache.get_many(list(keys.values()))
        series = {cell: hits[k] for cell, k in keys.items() if k in hits}
        misses = [cell for cell in cells if cell not in series]
        batches = [misses[i : i + BATCH_SIZE] for i in range(0, len(misses), BATCH_SIZE)]
        failed: set[Cell] = set()
        if batches:
            pool = ThreadPoolExecutor(max_workers=MAX_IN_FLIGHT, thread_name_prefix="openmeteo")
            try:
                pending: dict[Future[list[LocationSeries]], list[Cell]] = {
                    pool.submit(
                        contextvars.copy_context().run,
                        self._fetch_batch,
                        b,
                        start_utc,
                        end_utc,
                        deadline,
                    ): b
                    for b in batches
                }
                done_count = 0
                yield BatchProgress(done=0, total=len(batches))
                while pending:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise UpstreamTimeoutError("The weather service timed out.")
                    finished, _ = wait(pending, timeout=remaining, return_when=FIRST_COMPLETED)
                    for future in finished:
                        batch = pending.pop(future)
                        try:
                            for cell, s in zip(batch, future.result(), strict=True):
                                series[cell] = s
                        except (UpstreamRateLimitedError, UpstreamTimeoutError):
                            raise
                        except UpstreamUnavailableError:
                            failed.update(batch)
                        done_count += 1
                        yield BatchProgress(done=done_count, total=len(batches))
            finally:
                # Batches already running finish into the cache; queued ones are dropped.
                pool.shutdown(wait=False, cancel_futures=True)
            if len(failed) == len(misses):
                raise UpstreamUnavailableError("The weather service is unavailable.")
        return WeatherResult(
            series=series,
            failed=frozenset(failed),
            cached=len(cells) - len(misses),
            fetched=len(misses) - len(failed),
        )

    def _fetch_batch(
        self, cells: list[Cell], start_utc: int, end_utc: int, deadline: float
    ) -> list[LocationSeries]:
        self._bucket.acquire(len(cells), max_wait_s=max(0.0, deadline - time.monotonic()))
        data: dict[str, str] = {
            "latitude": ",".join(f"{c[0]:.1f}" for c in cells),
            "longitude": ",".join(f"{c[1]:.1f}" for c in cells),
            "hourly": ",".join(HOURLY_VARIABLES),
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timeformat": "unixtime",
            "timezone": "GMT",
            "start_hour": hour_param(start_utc),
            "end_hour": hour_param(end_utc),
        }
        if self._key:
            data["apikey"] = self._key
        url = f"{self._base}/v1/forecast"
        with _in_flight:
            timeout = max(0.1, min(BATCH_TIMEOUT_S, deadline - time.monotonic()))
            response = send_with_retries(
                "weather", lambda: self.http.post(url, data=data, timeout=timeout)
            )
        remaining = response.headers.get("x-ratelimit-remaining")
        if remaining is not None:
            with contextlib.suppress(ValueError):
                self._bucket.observe_remaining(float(remaining))
        if response.status_code != 200:
            log.warning("weather HTTP %s for a batch of %d", response.status_code, len(cells))
            raise UpstreamUnavailableError("The weather service rejected a request.")
        try:
            parsed = parse_batch(response.json(), len(cells))
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("weather payload malformed: %s", exc)
            raise UpstreamUnavailableError(
                "The weather service returned an unexpected response."
            ) from exc
        cache.set_many(
            {cache_key(c, start_utc, end_utc): s for c, s in zip(cells, parsed, strict=True)},
            CACHE_TTL_S,
        )
        return parsed


def default_client() -> OpenMeteoClient:
    return OpenMeteoClient(settings.OPEN_METEO_BASE_URL, settings.OPEN_METEO_API_KEY)
