"""TomTom Routing (truck) and Fuzzy Search clients (api-contracts skill, "External APIs").

Errors are mapped on ``detailedError.code``, never on message text. Parsed routes are cached as
flat float tuples, which pickle quickly in both LocMem and Redis.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
from django.conf import settings
from django.core.cache import cache

from trips.domain.resample import route_geom
from trips.domain.types import LatLon, ProgressEntry, RouteGeom
from trips.services import clock
from trips.services.errors import (
    InvalidRequestError,
    NoRouteError,
    UpstreamTimeoutError,
    UpstreamUnavailableError,
)
from trips.services.http import send_with_retries, shared_client

log = logging.getLogger(__name__)

LB_TO_KG = 0.45359237
ROUTING_TIMEOUT_S = 10.0
SEARCH_TIMEOUT_S = 5.0
ROUTE_CACHE_TTL_S = 15 * 60
DEPARTURE_BUCKET_S = 15 * 60
DEPART_NOW_WITHIN_S = 120
"""TomTom rejects a past ``departAt``; anything this close to now is sent as ``now``."""

NO_ROUTE_CODES = frozenset({"NO_ROUTE_FOUND", "MAP_MATCHING_FAILURE"})


@dataclass(frozen=True, slots=True)
class TomTomRoute:
    """One TomTom route in a compact, cache-friendly form."""

    lats: tuple[float, ...]
    lons: tuple[float, ...]
    length_m: float
    travel_time_s: float
    traffic_delay_s: float
    progress: tuple[tuple[int, float, float], ...]
    """``(pointIndex, distanceInMeters, travelTimeInSeconds)`` entries, cumulative."""

    def geom(self) -> RouteGeom:
        points = [LatLon(lat, lon) for lat, lon in zip(self.lats, self.lons, strict=True)]
        progress = [ProgressEntry(i, d, t) for i, d, t in self.progress if i < len(points)]
        return route_geom(points, self.length_m, self.travel_time_s, progress)


@dataclass(frozen=True, slots=True)
class Place:
    label: str
    lat: float
    lon: float
    kind: str


def weight_kg(weight_lb: float) -> int:
    return round(weight_lb * LB_TO_KG)


def _depart_at(depart_at_utc: float, now_utc: float) -> str:
    if depart_at_utc <= now_utc + DEPART_NOW_WITHIN_S:
        return "now"
    stamp = dt.datetime.fromtimestamp(round(depart_at_utc), tz=dt.UTC)
    return stamp.isoformat().replace("+00:00", "Z")


def _error_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    detailed = body.get("detailedError")
    if isinstance(detailed, dict) and isinstance(detailed.get("code"), str):
        return str(detailed["code"])
    return None


def parse_routes(body: Any) -> list[TomTomRoute]:
    """Parse a calculateRoute body. Malformed payloads raise ``UpstreamUnavailableError``."""
    try:
        routes = []
        for raw in body["routes"]:
            summary = raw["summary"]
            lats: list[float] = []
            lons: list[float] = []
            for leg in raw["legs"]:
                for p in leg["points"]:
                    lats.append(float(p["latitude"]))
                    lons.append(float(p["longitude"]))
            progress = tuple(
                (
                    int(e["pointIndex"]),
                    float(e["distanceInMeters"]),
                    float(e["travelTimeInSeconds"]),
                )
                for e in raw.get("progress", ())
            )
            routes.append(
                TomTomRoute(
                    lats=tuple(lats),
                    lons=tuple(lons),
                    length_m=float(summary["lengthInMeters"]),
                    travel_time_s=float(summary["travelTimeInSeconds"]),
                    traffic_delay_s=float(summary.get("trafficDelayInSeconds", 0)),
                    progress=progress,
                )
            )
    except (KeyError, TypeError, ValueError) as exc:
        raise UpstreamUnavailableError(
            "The routing service returned an unexpected response."
        ) from exc
    if not routes or any(len(r.lats) < 2 or r.length_m <= 0 for r in routes):
        raise UpstreamUnavailableError("The routing service returned an unexpected response.")
    return routes


class TomTomClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.tomtom.com",
        http: httpx.Client | None = None,
    ) -> None:
        self._key = api_key
        self._base = base_url.rstrip("/")
        self._http = http

    @property
    def http(self) -> httpx.Client:
        return self._http or shared_client()

    def _require_key(self) -> None:
        if not self._key:
            log.error("TOMTOM_API_KEY is not set")
            raise UpstreamUnavailableError("Routing is not configured on this server.")

    def calculate_routes(
        self,
        waypoints: Sequence[LatLon],
        depart_at_utc: float,
        weight_lb: float,
        *,
        max_alternatives: int = 4,
    ) -> list[TomTomRoute]:
        """Truck routes through ``waypoints`` (origin, optional vias, destination)."""
        locations = ":".join(f"{p.lat:.6f},{p.lon:.6f}" for p in waypoints)
        cache_key = (
            f"tomtom:route:v1:{locations}:{int(depart_at_utc // DEPARTURE_BUCKET_S)}:"
            f"{weight_kg(weight_lb)}:{max_alternatives}"
        )
        cached: list[TomTomRoute] | None = cache.get(cache_key)
        if cached is not None:
            return cached
        self._require_key()
        params: list[tuple[str, str | int | float | bool | None]] = [
            ("key", self._key),
            ("travelMode", "truck"),
            ("vehicleWeight", weight_kg(weight_lb)),
            ("vehicleCommercial", "true"),
            ("maxAlternatives", max_alternatives),
            ("alternativeType", "anyRoute"),
            ("routeType", "fastest"),
            ("traffic", "true"),
            ("departAt", _depart_at(depart_at_utc, clock.now_utc())),
            ("computeTravelTimeFor", "all"),
            ("routeRepresentation", "polyline"),
            ("extendedRouteRepresentation", "distance"),
            ("extendedRouteRepresentation", "travelTime"),
        ]
        url = f"{self._base}/routing/1/calculateRoute/{locations}/json"
        response = send_with_retries(
            "routing", lambda: self.http.get(url, params=params, timeout=ROUTING_TIMEOUT_S)
        )
        if response.status_code != 200:
            raise self._map_error(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise UpstreamUnavailableError(
                "The routing service returned an unexpected response."
            ) from exc
        routes = parse_routes(body)
        cache.set(cache_key, routes, ROUTE_CACHE_TTL_S)
        return routes

    @staticmethod
    def _map_error(response: httpx.Response) -> Exception:
        code = _error_code(response)
        log.warning("routing HTTP %s code=%s", response.status_code, code)
        if code in NO_ROUTE_CODES:
            return NoRouteError()
        if code == "COMPUTE_TIME_LIMIT_EXCEEDED":
            return UpstreamTimeoutError("The routing service ran out of time for this trip.")
        if code == "BAD_INPUT":
            return InvalidRequestError("The routing service rejected these trip parameters.")
        if response.status_code in (401, 403):
            log.error("TomTom rejected the API key (HTTP %s)", response.status_code)
        return UpstreamUnavailableError("The routing service is unavailable.")

    def fuzzy_search(self, query: str, limit: int) -> list[Place]:
        self._require_key()
        url = f"{self._base}/search/2/search/{quote(query, safe='')}.json"
        params: dict[str, str | int] = {
            "key": self._key,
            "typeahead": "true",
            "limit": limit,
            "countrySet": "US,CA,MX",
            "idxSet": "Geo,PAD,Addr,Str",
        }
        response = send_with_retries(
            "geocoding", lambda: self.http.get(url, params=params, timeout=SEARCH_TIMEOUT_S)
        )
        if response.status_code != 200:
            log.warning("geocoding HTTP %s", response.status_code)
            raise UpstreamUnavailableError("The geocoding service is unavailable.")
        return parse_search(response)


_KINDS = {
    "Geography": "Geo",
    "Point Address": "PAD",
    "Address Range": "Addr",
    "Street": "Str",
    "Cross Street": "Str",
    "POI": "POI",
}


def parse_search(response: httpx.Response) -> list[Place]:
    try:
        results = response.json()["results"]
        return [
            Place(
                label=str(r["address"]["freeformAddress"]),
                lat=float(r["position"]["lat"]),
                lon=float(r["position"]["lon"]),
                kind=_KINDS.get(str(r.get("type", "")), "Geo"),
            )
            for r in results
        ]
    except (KeyError, TypeError, ValueError) as exc:
        raise UpstreamUnavailableError(
            "The geocoding service returned an unexpected response."
        ) from exc


def default_client() -> TomTomClient:
    return TomTomClient(settings.TOMTOM_API_KEY, settings.TOMTOM_BASE_URL)
