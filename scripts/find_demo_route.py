"""Find a demo trip with interesting weather for the recording (PLAN.md sections 13 and 15).

Usage (from the repo root):
    uv run --directory backend python ../scripts/find_demo_route.py              # live APIs
    uv run --directory backend python ../scripts/find_demo_route.py --fixtures   # offline check

Scans candidate trips x departures (+0 ... +72 h, every 6 h) x load weights (25,000 and
45,000 lb) with the real planner and ranks them by:
  1. the load weight flips the recommendation (same trip and departure),
  2. the recommended route is not the fastest one,
  3. the worst risk level on any route, then miles at Moderate or worse.
It prints the top candidates with the numbers to put in the "Try demo trip" preset.

Quota: one TomTom routing call per trip and weight (plus via-point detours when a trip has fewer
than 3 distinct routes), reused for every departure, so ETAs shift with the departure but traffic
is the one predicted for the first departure. Weather is fetched once per trip for the whole scan
window, only for checkpoint cells (no heatmap cells): about 150-400 Open-Meteo locations per trip,
which counts against the free tier's 10,000/day. Run it once, on the morning of the recording.

TOMTOM_API_KEY is read from backend/.env through Django settings. It is never printed: every
line this script writes goes through `redact`.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import logging
import os
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from trips.domain.levels import Level  # noqa: E402
from trips.domain.timealign import HOUR_S, floor_hour  # noqa: E402
from trips.domain.types import Cell, LatLon  # noqa: E402
from trips.services import clock, openmeteo, tomtom  # noqa: E402
from trips.services.errors import NoRouteError, PlanError  # noqa: E402
from trips.services.fixtures import FixtureRouting, FixtureWeather  # noqa: E402
from trips.services.openmeteo import WeatherResult  # noqa: E402
from trips.services.planner import (  # noqa: E402
    Endpoint,
    Planner,
    PlanRequest,
    PlanResult,
    RoutingProvider,
)
from trips.services.timezones import tz_at  # noqa: E402
from trips.services.tomtom import TomTomRoute  # noqa: E402
from trips.services.weather import WeatherProvider, forecast_end_utc, unique_cells  # noqa: E402

# Candidate trips from PLAN.md section 15. Coordinates are city centers.
TRIPS: dict[str, tuple[Endpoint, Endpoint]] = {
    "denver_slc": (
        Endpoint("Denver, CO, USA", 39.7392, -104.9903),
        Endpoint("Salt Lake City, UT, USA", 40.7608, -111.8910),
    ),
    "chicago_denver": (
        Endpoint("Chicago, IL, USA", 41.8781, -87.6298),
        Endpoint("Denver, CO, USA", 39.7392, -104.9903),
    ),
    "seattle_boise": (
        Endpoint("Seattle, WA, USA", 47.6062, -122.3321),
        Endpoint("Boise, ID, USA", 43.6150, -116.2023),
    ),
    "billings_spokane": (
        Endpoint("Billings, MT, USA", 45.7833, -108.5007),
        Endpoint("Spokane, WA, USA", 47.6588, -117.4260),
    ),
    "flagstaff_albuquerque": (
        Endpoint("Flagstaff, AZ, USA", 35.1983, -111.6513),
        Endpoint("Albuquerque, NM, USA", 35.0844, -106.6504),
    ),
}
WEIGHTS_LB = (25_000, 45_000)
DEPARTURE_OFFSETS_H = tuple(range(0, 73, 6))
INTERVAL_MI = 25  # the UI's default checkpoint interval
# The longest trip above takes about 17 h; the window covers its last ETA after +72 h.
SCAN_WINDOW_H = 72 + 24 + 2
FETCH_DEADLINE_S = 600.0


def redact(text: str) -> str:
    key = str(getattr(settings, "TOMTOM_API_KEY", "") or "")
    return text.replace(key, "***") if key else text


def say(text: str = "") -> None:
    print(redact(text), flush=True)


class RoutesPerWeight:
    """TomTom routes reused across departures: keyed by waypoints, weight and alternatives."""

    def __init__(self, inner: RoutingProvider) -> None:
        self.inner = inner
        self.calls = 0
        self._cache: dict[tuple[tuple[LatLon, ...], int, int], list[TomTomRoute]] = {}

    def calculate_routes(
        self,
        waypoints: Sequence[LatLon],
        depart_at_utc: float,
        weight_lb: float,
        *,
        max_alternatives: int = 4,
    ) -> list[TomTomRoute]:
        key = (tuple(waypoints), round(weight_lb), max_alternatives)
        if key not in self._cache:
            self.calls += 1
            self._cache[key] = self.inner.calculate_routes(
                waypoints, depart_at_utc, weight_lb, max_alternatives=max_alternatives
            )
        return self._cache[key]


class ScanWeather:
    """Fetches each cell once for the whole scan window and serves it to every plan."""

    def __init__(self, inner: WeatherProvider, start_utc: int, end_utc: int) -> None:
        self.inner = inner
        self.start_utc = start_utc
        self.end_utc = end_utc
        self.locations = 0
        self._series: dict[Cell, Any] = {}
        self._failed: set[Cell] = set()

    def result(self, cells: Sequence[Cell]) -> WeatherResult:
        missing = [c for c in unique_cells([cells]) if c not in self._series]
        missing = [c for c in missing if c not in self._failed]
        if missing:
            self.locations += len(missing)
            fetch = self.inner.fetch(
                missing,
                self.start_utc,
                self.end_utc,
                deadline=time.monotonic() + FETCH_DEADLINE_S,
            )
            while True:
                try:
                    next(fetch)
                except StopIteration as stop:
                    got: WeatherResult = stop.value
                    break
            self._series.update(got.series)
            self._failed.update(got.failed)
        series = {c: self._series[c] for c in cells if c in self._series}
        failed = frozenset(c for c in cells if c in self._failed)
        return WeatherResult(series=series, failed=failed, cached=0, fetched=len(series))


def plan_checkpoints_only(planner: Planner, weather: ScanWeather, req: PlanRequest) -> PlanResult:
    """`Planner.stream` without the heatmap cells (the scan never looks at the heatmap)."""
    phase = planner._route_phase(req)
    if not phase.selected:
        raise NoRouteError()
    routes = tuple(planner._planned_route(req, i, s) for i, s in enumerate(phase.selected))
    lookup = planner._lookup_plan(req, routes, phase.lattice_lines)
    cells = unique_cells([cp.lookup_cell for cp in cps] for cps in lookup.checkpoints.values())
    return planner._assemble(
        req, routes, lookup, weather.result(cells), clock.now_utc(), weather.end_utc
    )


@dataclasses.dataclass(frozen=True)
class Candidate:
    trip: str
    departure_utc: float
    origin_tz: str
    weight_lb: int
    recommended: str
    fastest: str
    decisive_step: str | None
    worst: Level
    moderate_plus_mi: float
    routes: str
    weight_flip: bool = False

    def sort_key(self) -> tuple[bool, bool, int, float]:
        return (
            self.weight_flip,
            self.recommended != self.fastest,
            int(self.worst),
            self.moderate_plus_mi,
        )


def summarize(trip: str, req: PlanRequest, plan: PlanResult) -> Candidate:
    rec = plan.recommendation[INTERVAL_MI]
    fastest = min(plan.routes, key=lambda r: r.duration_s).id
    worst = Level.LOW
    moderate_plus = 0.0
    parts = []
    for route in plan.routes:
        agg = plan.intervals[route.id][INTERVAL_MI].aggregates
        if agg.max_level is not None and agg.max_level > worst:
            worst = agg.max_level
        mi = sum(m for level, m in agg.miles_by_level.items() if level >= Level.MODERATE)
        moderate_plus += mi
        max_label = agg.max_level.label if agg.max_level is not None else "No data"
        parts.append(
            f"{route.id} {route.distance_mi:.0f} mi {route.duration_s / 3600:.1f} h "
            f"worst {max_label}, {mi:.0f} mi >= Moderate"
        )
    return Candidate(
        trip=trip,
        departure_utc=req.departure_utc,
        origin_tz=req.origin_tz,
        weight_lb=round(req.load_weight_lb),
        recommended=rec.route_id,
        fastest=fastest,
        decisive_step=rec.decisive_step,
        worst=worst,
        moderate_plus_mi=moderate_plus,
        routes="; ".join(parts),
    )


def local_departure(c: Candidate) -> str:
    return dt.datetime.fromtimestamp(c.departure_utc, ZoneInfo(c.origin_tz)).strftime(
        "%Y-%m-%dT%H:%M (%Z)"
    )


def scan(trips: Sequence[str], *, fixtures: bool) -> tuple[list[Candidate], int, int]:
    now = clock.now_utc()
    first_departure = floor_hour(now) + HOUR_S
    start = first_departure - HOUR_S
    end = min(start + SCAN_WINDOW_H * HOUR_S, forecast_end_utc(now))
    routing: RoutingProvider = FixtureRouting() if fixtures else tomtom.default_client()
    inner_weather: WeatherProvider = FixtureWeather() if fixtures else openmeteo.default_client()
    cached_routing = RoutesPerWeight(routing)
    weather = ScanWeather(inner_weather, start, end)
    planner = Planner(cached_routing, inner_weather, memo_ns="find_demo_route")

    found: list[Candidate] = []
    for trip in trips:
        origin, destination = TRIPS[trip]
        origin_tz = tz_at(origin.lat, origin.lon)
        by_departure: dict[float, dict[int, Candidate]] = {}
        for offset_h in DEPARTURE_OFFSETS_H:
            departure = first_departure + offset_h * HOUR_S
            for weight in WEIGHTS_LB:
                req = PlanRequest(origin, destination, departure, origin_tz, weight, False)
                try:
                    plan = plan_checkpoints_only(planner, weather, req)
                except PlanError as exc:  # fixed messages, never the URL or key
                    say(f"  {trip} +{offset_h} h {weight} lb: skipped ({type(exc).__name__})")
                    continue
                by_departure.setdefault(departure, {})[weight] = summarize(trip, req, plan)
        for per_weight in by_departure.values():
            flip = len({c.recommended for c in per_weight.values()}) > 1
            found.extend(dataclasses.replace(c, weight_flip=flip) for c in per_weight.values())
        say(f"scanned {trip}: {len(by_departure)} departures")
    return found, cached_routing.calls, weather.locations


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--fixtures", action="store_true", help="recorded data, no network")
    parser.add_argument("--trip", action="append", choices=sorted(TRIPS), help="repeatable")
    parser.add_argument("--top", type=int, default=5)
    args = parser.parse_args(argv)

    if not args.fixtures and not settings.TOMTOM_API_KEY:
        say("TOMTOM_API_KEY is not set in backend/.env (use --fixtures for an offline run).")
        return 2
    trips = args.trip or list(TRIPS)
    if args.fixtures:
        # Fixture routing serves the nearest recorded trip, so only the recorded ones make sense.
        trips = [t for t in trips if t in {"denver_slc", "chicago_denver", "seattle_boise"}]

    try:
        found, tomtom_calls, locations = scan(trips, fixtures=args.fixtures)
    except Exception as exc:  # never let a traceback carry a request URL to the terminal
        say(f"scan failed: {type(exc).__name__}: {exc}")
        return 1

    ranked = sorted(found, key=Candidate.sort_key, reverse=True)[: args.top]
    say()
    say(
        f"{len(found)} plans from {tomtom_calls} TomTom routing calls and "
        f"{locations} Open-Meteo locations ({'fixtures' if args.fixtures else 'live'})."
    )
    say(f"Top {len(ranked)} at {INTERVAL_MI}-mile checkpoints:")
    for i, c in enumerate(ranked, 1):
        origin, destination = TRIPS[c.trip]
        flags = [
            "weight flips the pick" if c.weight_flip else "",
            "pick is not the fastest" if c.recommended != c.fastest else "",
        ]
        say()
        say(f"{i}. {origin.label} -> {destination.label}, {c.weight_lb:,} lb")
        say(f"   departure_local {local_departure(c)}")
        say(
            f"   recommended {c.recommended} (fastest {c.fastest}, decided by "
            f"{c.decisive_step}); worst {c.worst.label}; "
            + (", ".join(f for f in flags if f) or "no flips")
        )
        say(f"   {c.routes}")
    return 0


if __name__ == "__main__":
    logging.getLogger("trips").setLevel(logging.WARNING)  # a log line per plan is noise here
    sys.exit(main())
