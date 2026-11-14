"""Fixture mode (``PLAN_FIXTURES=1``): serve recorded TomTom and Open-Meteo data offline.

Used by local development without keys, CI and the Playwright E2E run. The ``X-Fixture``
request header picks a scenario:

- ``default``: the recorded trip nearest to the requested origin and destination.
- ``two_routes``: only two distinct routes and no via-point detours (``FEWER_THAN_3_ROUTES``).
- ``no_travel_all``: 60 mph sustained wind everywhere, so every route is No Travel.
- ``upstream_429``: the weather service is rate limited (503 / in-stream error).
- ``no_route``: TomTom finds no truck route (422).

Weather for any cell comes from the nearest recorded location, with its 73 recorded hours
repeated cyclically to cover the requested window. That keeps the replay deterministic for any
departure time. The fixtures live under ``trips/tests/fixtures`` and are not in the Docker image.
"""

from __future__ import annotations

import functools
import gzip
import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final

from django.conf import settings

from trips.domain.geometry import haversine_m
from trips.domain.routes_select import select_routes
from trips.domain.timealign import HOUR_S
from trips.domain.types import Cell, LatLon
from trips.services.errors import NoRouteError, UpstreamRateLimitedError
from trips.services.openmeteo import (
    BATCH_SIZE,
    HOURLY_VARIABLES,
    BatchProgress,
    WeatherFetch,
    WeatherResult,
    parse_location,
)
from trips.services.tomtom import Place, TomTomRoute, parse_routes

SCENARIOS: Final = ("default", "two_routes", "no_travel_all", "upstream_429", "no_route")
NO_TRAVEL_WIND_MPH = 60.0
FIXTURE_RETRY_AFTER_S = 30


def fixtures_dir() -> Path:
    return Path(settings.BASE_DIR) / "trips" / "tests" / "fixtures"


def _load_gz(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


@functools.cache
def recorded_trips() -> dict[str, tuple[LatLon, LatLon, list[TomTomRoute]]]:
    trips: dict[str, tuple[LatLon, LatLon, list[TomTomRoute]]] = {}
    for path in sorted((fixtures_dir() / "tomtom").glob("*.json.gz")):
        data = _load_gz(path)
        (olat, olon), (dlat, dlon) = data["request"]["origin"], data["request"]["destination"]
        trips[path.name.removesuffix(".json.gz")] = (
            LatLon(olat, olon),
            LatLon(dlat, dlon),
            parse_routes(data["response"]),
        )
    return trips


@functools.cache
def recorded_weather() -> tuple[tuple[Cell, dict[str, Any]], ...]:
    """``(requested cell, Open-Meteo item)`` pairs from the recorded batch."""
    data = _load_gz(fixtures_dir() / "openmeteo" / "denver_slc_100.json.gz")
    lats = [float(v) for v in data["request"]["latitude"].split(",")]
    lons = [float(v) for v in data["request"]["longitude"].split(",")]
    return tuple(
        ((lat, lon), item) for lat, lon, item in zip(lats, lons, data["response"], strict=True)
    )


def nearest_trip(origin: LatLon, destination: LatLon) -> list[TomTomRoute]:
    trips = recorded_trips().values()
    _, _, routes = min(
        trips, key=lambda t: haversine_m(origin, t[0]) + haversine_m(destination, t[1])
    )
    return routes


def synthesize_item(
    cell: Cell, start_utc: int, end_utc: int, scenario: str = "default"
) -> dict[str, Any]:
    """An Open-Meteo-shaped hourly block for ``cell`` over ``[start_utc, end_utc]``."""
    recorded = recorded_weather()
    cos_lat = math.cos(math.radians(cell[0]))
    _, item = min(
        recorded, key=lambda r: (r[0][0] - cell[0]) ** 2 + ((r[0][1] - cell[1]) * cos_lat) ** 2
    )
    hourly = item["hourly"]
    rec_start = int(hourly["time"][0])
    n = len(hourly["time"])
    times = list(range(start_utc, end_utc + 1, HOUR_S))
    idx = [((t - rec_start) // HOUR_S) % n for t in times]
    out: dict[str, Any] = {"time": times}
    for name in HOURLY_VARIABLES:
        out[name] = [hourly[name][i] for i in idx]
    if scenario == "no_travel_all":
        out["wind_speed_10m"] = [NO_TRAVEL_WIND_MPH] * len(times)
    return {"latitude": cell[0], "longitude": cell[1], "hourly": out}


_PLACES: Final = (
    Place("Denver, CO, USA", 39.7392, -104.9903, "Geo"),
    Place("Salt Lake City, UT, USA", 40.7608, -111.8910, "Geo"),
    Place("Chicago, IL, USA", 41.8781, -87.6298, "Geo"),
    Place("Seattle, WA, USA", 47.6062, -122.3321, "Geo"),
    Place("Boise, ID, USA", 43.6150, -116.2023, "Geo"),
    Place("Dallas, TX, USA", 32.7767, -96.7970, "Geo"),
    Place("Albuquerque, NM, USA", 35.0844, -106.6504, "Geo"),
    Place("Cheyenne, WY, USA", 41.1400, -104.8202, "Geo"),
    Place("Denton, TX, USA", 33.2148, -97.1331, "Geo"),
)


class FixtureRouting:
    def __init__(self, scenario: str = "default") -> None:
        self.scenario = scenario

    def calculate_routes(
        self,
        waypoints: Sequence[LatLon],
        depart_at_utc: float,
        weight_lb: float,
        *,
        max_alternatives: int = 4,
    ) -> list[TomTomRoute]:
        if self.scenario == "no_route" or len(waypoints) != 2:
            raise NoRouteError()  # via-point detours were not recorded
        routes = nearest_trip(waypoints[0], waypoints[-1])
        if self.scenario == "two_routes":
            kept = select_routes([r.geom() for r in routes], keep=2).kept
            return [routes[i] for i in kept]
        return routes[: max_alternatives + 1]

    def fuzzy_search(self, query: str, limit: int) -> list[Place]:
        q = query.casefold()
        return [p for p in _PLACES if q in p.label.casefold()][:limit]


class FixtureWeather:
    def __init__(self, scenario: str = "default") -> None:
        self.scenario = scenario

    def fetch(
        self, cells: Sequence[Cell], start_utc: int, end_utc: int, *, deadline: float
    ) -> WeatherFetch:
        if self.scenario == "upstream_429":
            raise UpstreamRateLimitedError(
                "The weather service is busy. Try again shortly.",
                retry_after_s=FIXTURE_RETRY_AFTER_S,
            )
        total = math.ceil(len(cells) / BATCH_SIZE)
        yield BatchProgress(done=0, total=total)
        series = {}
        for b in range(total):
            for cell in cells[b * BATCH_SIZE : (b + 1) * BATCH_SIZE]:
                series[cell] = parse_location(
                    {"hourly": synthesize_item(cell, start_utc, end_utc, self.scenario)["hourly"]}
                )
            yield BatchProgress(done=b + 1, total=total)
        return WeatherResult(series=series, failed=frozenset(), cached=0, fetched=len(cells))
