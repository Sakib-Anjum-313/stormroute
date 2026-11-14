"""API test harness: live clients against respx mocks built from the recorded fixtures.

TomTom answers with the recorded Denver to Salt Lake City response. Open-Meteo answers every
POSTed batch with the nearest recorded location's hours (see ``services.fixtures``), so batch
sizes, form parameters and call counts are all observable.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
import respx
from django.core.cache import cache
from django.test import Client

from trips.services import clock, openmeteo, planner
from trips.services.fixtures import synthesize_item
from trips.services.ratelimit import TokenBucket

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
SECRET_KEY = "tt-secret-0123456789abcdef"
NOW_UTC = 1_794_646_800.0  # 2026-11-14T09:00:00Z, inside the recorded forecast window
TOMTOM_ROUTE_URL = r"https://api\.tomtom\.com/routing/1/calculateRoute/.*"
TOMTOM_SEARCH_URL = r"https://api\.tomtom\.com/search/2/search/.*"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

DENVER = {"label": "Denver, CO, USA", "lat": 39.7392, "lon": -104.9903}
SLC = {"label": "Salt Lake City, UT, USA", "lat": 40.7608, "lon": -111.8910}


def plan_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "origin": DENVER,
        "destination": SLC,
        "departure_local": "2026-11-14T03:00",  # 10:00Z (Denver is UTC-7 in November)
        "load_weight_lb": 45_000,
        "apply_hos": False,
    }
    body.update(overrides)
    return body


def load_tomtom(name: str) -> dict[str, Any]:
    with gzip.open(FIXTURES / "tomtom" / f"{name}.json.gz", "rt") as fh:
        data: dict[str, Any] = json.load(fh)
    return data


def tomtom_error(code: str, status: int = 400) -> httpx.Response:
    return httpx.Response(
        status,
        json={
            "formatVersion": "0.0.12",
            "error": {"description": "Unable to find a route."},
            "detailedError": {"code": code, "message": "Unable to find a route."},
        },
    )


def form(request: httpx.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


def open_meteo_ok(request: httpx.Request, scenario: str = "default") -> httpx.Response:
    data = form(request)
    lats = [float(v) for v in data["latitude"].split(",")]
    lons = [float(v) for v in data["longitude"].split(",")]
    start = _parse_hour(data["start_hour"])
    end = _parse_hour(data["end_hour"])
    items = [synthesize_item((a, b), start, end, scenario) for a, b in zip(lats, lons, strict=True)]
    body: Any = items[0] if len(items) == 1 else items
    return httpx.Response(
        200,
        json=body,
        headers={"x-ratelimit-cost": f"{len(items)}.0", "x-ratelimit-remaining": "600"},
    )


def _parse_hour(text: str) -> int:
    import datetime as dt

    return int(dt.datetime.strptime(text, "%Y-%m-%dT%H:%M").replace(tzinfo=dt.UTC).timestamp())


class Upstreams:
    """Handles to the mocked routes, so tests can swap behavior and count calls."""

    def __init__(self, router: respx.MockRouter) -> None:
        self.router = router
        self.denver_slc = load_tomtom("denver_slc")["response"]
        self.route = router.get(url__regex=TOMTOM_ROUTE_URL).mock(
            return_value=httpx.Response(200, json=self.denver_slc)
        )
        self.search = router.get(url__regex=TOMTOM_SEARCH_URL)
        self.weather = router.post(OPEN_METEO_URL).mock(side_effect=open_meteo_ok)

    def weather_side_effect(self, fn: Callable[[httpx.Request], httpx.Response]) -> None:
        self.weather.mock(side_effect=fn)


@pytest.fixture(autouse=True)
def _isolated(settings: Any, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    settings.PLAN_FIXTURES = False
    settings.TOMTOM_API_KEY = SECRET_KEY
    settings.UPSTREAM_RETRY_DELAYS_S = (0.0, 0.0)
    settings.ALLOWED_HOSTS = ["testserver"]
    monkeypatch.setattr(clock, "now_utc", lambda: NOW_UTC)
    monkeypatch.setattr(openmeteo, "_bucket", TokenBucket(openmeteo.LOCATIONS_PER_MINUTE, 60.0))
    cache.clear()
    planner.clear_memo()
    yield
    cache.clear()
    planner.clear_memo()


@pytest.fixture
def upstreams() -> Iterator[Upstreams]:
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as router:
        yield Upstreams(router)


@pytest.fixture
def api(client: Client) -> Callable[..., Any]:
    def post(body: Any, accept: str = "application/json", **headers: Any) -> Any:
        payload = body if isinstance(body, str) else json.dumps(body)
        return client.post(
            "/api/plan", payload, content_type="application/json", HTTP_ACCEPT=accept, **headers
        )

    return post


def ndjson_events(response: Any) -> list[dict[str, Any]]:
    text = b"".join(response.streaming_content).decode()
    return [json.loads(line) for line in text.splitlines()]
