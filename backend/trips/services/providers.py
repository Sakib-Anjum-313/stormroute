"""Build live or fixture-backed providers from settings (``PLAN_FIXTURES``)."""

from __future__ import annotations

from django.conf import settings

from trips.services import openmeteo, tomtom
from trips.services.errors import InvalidRequestError
from trips.services.fixtures import SCENARIOS, FixtureRouting, FixtureWeather
from trips.services.geocode import PlaceSearch
from trips.services.planner import Planner


def fixture_scenario(header: str | None) -> str:
    scenario = (header or "default").strip() or "default"
    if scenario not in SCENARIOS:
        raise InvalidRequestError(
            "Unknown fixture scenario.",
            details={"X-Fixture": [f"Use one of: {', '.join(SCENARIOS)}."]},
        )
    return scenario


def build_planner(fixture_header: str | None = None) -> Planner:
    if settings.PLAN_FIXTURES:
        scenario = fixture_scenario(fixture_header)
        return Planner(
            FixtureRouting(scenario), FixtureWeather(scenario), memo_ns=f"fixture:{scenario}"
        )
    return Planner(tomtom.default_client(), openmeteo.default_client(), memo_ns="live")


def build_place_search() -> tuple[PlaceSearch, str]:
    """The place-search provider and its cache namespace."""
    if settings.PLAN_FIXTURES:
        return FixtureRouting(), "fixture"
    return tomtom.default_client(), "live"
