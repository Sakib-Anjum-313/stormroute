"""Plan a trip: routes, checkpoints, weather, risk, recommendation and heatmap (PLAN §4).

``Planner.stream`` is a generator of typed events, in order: ``MetaEvent``, ``RoutesEvent``,
``ProgressEvent`` (one per weather batch, starting at ``done=0``) and ``ResultEvent``. All
routing happens before the first event, so a routing failure (for example ``NoRouteError``) can
still become an HTTP error status; later failures become an in-stream error in the view.

This module only orchestrates. Every rule lives in the pure ``trips.domain`` package, and every
upstream call goes through a provider (live clients or fixture replay).
"""

from __future__ import annotations

import contextvars
import dataclasses
import logging
import time
from collections.abc import Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Literal, Protocol

from trips.domain.attribution import Aggregates, aggregate
from trips.domain.checkpoints import build_checkpoints
from trips.domain.detours import detour_acceptable, detour_vias
from trips.domain.eta import TimeAnchors, distance_m_at, time_anchors
from trips.domain.geometry import METERS_PER_MILE, simplify, snap
from trips.domain.heatmap_grid import (
    MIN_STRIDE_K,
    EncodedHeatmap,
    Lattice,
    build_frames,
    choose_lattice,
    encode_heatmap,
)
from trips.domain.hos import Stop, plan_stops, stop_time_before_s, total_stop_s
from trips.domain.polyline import encode as encode_polyline
from trips.domain.recommend import Recommendation, RouteScore, recommend
from trips.domain.resample import position_at
from trips.domain.risk import Assessment, assess
from trips.domain.routes_select import select_routes
from trips.domain.timealign import weather_at
from trips.domain.types import Cell, Checkpoint, LatLon, RouteGeom, Weather
from trips.services import clock
from trips.services.errors import NoRouteError, PlanError
from trips.services.memo import TTLMemo
from trips.services.openmeteo import WeatherResult
from trips.services.timezones import tz_at
from trips.services.tomtom import TomTomRoute
from trips.services.weather import (
    MAX_LOCATIONS,
    WeatherProvider,
    unique_cells,
    weather_window,
)

log = logging.getLogger(__name__)

INTERVALS_MI: tuple[int, ...] = (10, 25, 50)
ROUTES_TO_SHOW = 3
TOTAL_BUDGET_S = 25.0
DISPLAY_TOLERANCE_M = 20.0
LATTICE_TOLERANCE_M = 500.0
MAX_HEATMAP_STRIDE_K = 5
COARSE_SNAP_DEG = 0.2
ROUTE_LABELS = "ABCDEFGH"
ROUTE_PHASE_TTL_S = 15 * 60

RouteSource = Literal["tomtom", "via_point"]


class RoutingProvider(Protocol):
    def calculate_routes(
        self,
        waypoints: Sequence[LatLon],
        depart_at_utc: float,
        weight_lb: float,
        *,
        max_alternatives: int = 4,
    ) -> list[TomTomRoute]: ...


@dataclass(frozen=True, slots=True)
class Endpoint:
    label: str
    lat: float
    lon: float

    @property
    def pos(self) -> LatLon:
        return LatLon(self.lat, self.lon)


@dataclass(frozen=True, slots=True)
class PlanWarning:
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class PlanRequest:
    origin: Endpoint
    destination: Endpoint
    departure_utc: float
    origin_tz: str
    load_weight_lb: float
    apply_hos: bool
    warnings: tuple[PlanWarning, ...] = ()


@dataclass(frozen=True, slots=True)
class HosStop:
    kind: str
    mile: float
    pos: LatLon
    start_utc: float
    duration_s: float


@dataclass(frozen=True, slots=True)
class PlannedRoute:
    id: str
    label: str
    source: RouteSource
    geom: RouteGeom
    anchors: TimeAnchors
    polyline6: str
    distance_mi: float
    driving_s: float
    hos_stop_s: float
    duration_s: float
    departure_utc: float
    arrival_utc: float
    traffic_delay_s: float
    stops: tuple[HosStop, ...]
    hos: tuple[Stop, ...]


@dataclass(frozen=True, slots=True)
class CheckpointResult:
    checkpoint: Checkpoint
    tz: str
    weather: Weather | None
    assessment: Assessment


@dataclass(frozen=True, slots=True)
class IntervalResult:
    checkpoints: tuple[CheckpointResult, ...]
    aggregates: Aggregates


@dataclass(frozen=True, slots=True)
class PlanResult:
    request: PlanRequest
    generated_at_utc: float
    routes: tuple[PlannedRoute, ...]
    intervals: dict[str, dict[int, IntervalResult]]
    """Per route id, per interval (10, 25, 50)."""
    recommendation: dict[int, Recommendation]
    heatmap: EncodedHeatmap
    warnings: tuple[PlanWarning, ...]


@dataclass(frozen=True, slots=True)
class MetaEvent:
    departure_utc: float
    origin_tz: str


@dataclass(frozen=True, slots=True)
class RoutesEvent:
    routes: tuple[PlannedRoute, ...]


@dataclass(frozen=True, slots=True)
class ProgressEvent:
    stage: str
    done: int
    total: int


@dataclass(frozen=True, slots=True)
class ResultEvent:
    plan: PlanResult


PlanEvent = MetaEvent | RoutesEvent | ProgressEvent | ResultEvent


@dataclass(slots=True)
class Timings:
    """Upstream and compute time in milliseconds, for the ``Server-Timing`` header."""

    tomtom_ms: float = 0.0
    openmeteo_ms: float = 0.0
    compute_ms: float = 0.0

    def header(self) -> str:
        return (
            f"tomtom;dur={self.tomtom_ms:.0f}, openmeteo;dur={self.openmeteo_ms:.0f}, "
            f"compute;dur={self.compute_ms:.0f}"
        )


@dataclass(frozen=True, slots=True)
class _Candidate:
    route: TomTomRoute
    geom: RouteGeom
    source: RouteSource


@dataclass(frozen=True, slots=True)
class _SelectedRoute:
    """A kept route with everything that does not depend on departure details or HOS."""

    route: TomTomRoute
    geom: RouteGeom
    anchors: TimeAnchors
    source: RouteSource
    display: tuple[LatLon, ...]
    polyline6: str


@dataclass(frozen=True, slots=True)
class _RoutePhase:
    selected: tuple[_SelectedRoute, ...]
    lattice_lines: tuple[tuple[LatLon, ...], ...]


_route_phase_memo: TTLMemo[_RoutePhase] = TTLMemo(ROUTE_PHASE_TTL_S, max_entries=32)


def clear_memo() -> None:
    _route_phase_memo.clear()


@dataclass(slots=True)
class _LookupPlan:
    checkpoints: dict[tuple[str, int], list[Checkpoint]]
    lattice: Lattice
    coarsened: list[str] = field(default_factory=list)

    def cells(self) -> list[Cell]:
        groups: list[Sequence[Cell]] = [
            [cp.lookup_cell for cp in cps] for cps in self.checkpoints.values()
        ]
        groups.append(self.lattice.cells)
        return unique_cells(groups)


class Planner:
    def __init__(self, routing: RoutingProvider, weather: WeatherProvider, *, memo_ns: str) -> None:
        self.routing = routing
        self.weather = weather
        self.memo_ns = memo_ns
        self.timings = Timings()

    # -- routing ---------------------------------------------------------------------------

    def _fetch_routes(
        self, waypoints: Sequence[LatLon], req: PlanRequest, max_alternatives: int
    ) -> list[TomTomRoute]:
        started = time.monotonic()
        try:
            return self.routing.calculate_routes(
                waypoints,
                req.departure_utc,
                req.load_weight_lb,
                max_alternatives=max_alternatives,
            )
        finally:
            self.timings.tomtom_ms += (time.monotonic() - started) * 1000

    def _detours(self, req: PlanRequest, primary: RouteGeom) -> list[_Candidate]:
        """Via-point detours on both sides of the primary route (PLAN §2.1 S10)."""
        try:
            vias = detour_vias(primary, req.origin.pos, req.destination.pos)
        except ValueError:
            return []

        def one(via: LatLon) -> _Candidate | None:
            try:
                routes = self._fetch_routes(
                    [req.origin.pos, via, req.destination.pos], req, max_alternatives=0
                )
                return _Candidate(routes[0], routes[0].geom(), "via_point")
            except (PlanError, ValueError) as exc:
                log.info("via-point detour rejected: %s", type(exc).__name__)
                return None

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="detour") as pool:
            futures = [pool.submit(contextvars.copy_context().run, one, via) for via in vias]
            found = [f.result() for f in futures]
        return [c for c in found if c is not None]

    def _route_phase(self, req: PlanRequest) -> _RoutePhase:
        key = (
            f"{self.memo_ns}:{req.origin.lat:.6f},{req.origin.lon:.6f}:"
            f"{req.destination.lat:.6f},{req.destination.lon:.6f}:"
            f"{int(req.departure_utc // 900)}:{round(req.load_weight_lb)}"
        )
        cached = _route_phase_memo.get(key)
        if cached is not None:
            return cached
        routes = self._fetch_routes([req.origin.pos, req.destination.pos], req, 4)
        compute_started = time.monotonic()
        candidates = [_Candidate(r, r.geom(), "tomtom") for r in routes]
        kept = [candidates[i] for i in select_routes([c.geom for c in candidates]).kept]
        if len(kept) < ROUTES_TO_SHOW:
            self.timings.compute_ms += (time.monotonic() - compute_started) * 1000
            fastest = min(c.route.travel_time_s for c in kept)
            detours = [
                c
                for c in self._detours(req, kept[0].geom)
                if detour_acceptable(c.route.travel_time_s, fastest)
            ]
            compute_started = time.monotonic()
            if detours:
                pool = kept + detours
                kept = [pool[i] for i in select_routes([c.geom for c in pool]).kept]
        selected = []
        for c in kept:
            display = simplify(c.geom.points, DISPLAY_TOLERANCE_M)
            selected.append(
                _SelectedRoute(
                    route=c.route,
                    geom=c.geom,
                    anchors=time_anchors(c.geom),
                    source=c.source,
                    display=tuple(display),
                    polyline6=encode_polyline(display),
                )
            )
        phase = _RoutePhase(
            selected=tuple(selected),
            lattice_lines=tuple(tuple(simplify(s.display, LATTICE_TOLERANCE_M)) for s in selected),
        )
        self.timings.compute_ms += (time.monotonic() - compute_started) * 1000
        _route_phase_memo.set(key, phase)
        return phase

    @staticmethod
    def _planned_route(req: PlanRequest, index: int, s: _SelectedRoute) -> PlannedRoute:
        driving_s = s.route.travel_time_s
        hos = tuple(plan_stops(driving_s)) if req.apply_hos else ()
        stop_s = total_stop_s(hos)
        stops = []
        for stop in hos:
            distance_m = distance_m_at(s.anchors, stop.at_driving_s)
            stops.append(
                HosStop(
                    kind=stop.kind,
                    mile=distance_m / METERS_PER_MILE,
                    pos=position_at(s.geom, distance_m),
                    start_utc=req.departure_utc
                    + stop.at_driving_s
                    + stop_time_before_s(hos, stop.at_driving_s),
                    duration_s=stop.duration_s,
                )
            )
        label = ROUTE_LABELS[index]
        return PlannedRoute(
            id=label,
            label=f"Route {label}",
            source=s.source,
            geom=s.geom,
            anchors=s.anchors,
            polyline6=s.polyline6,
            distance_mi=s.geom.length_m / METERS_PER_MILE,
            driving_s=driving_s,
            hos_stop_s=stop_s,
            duration_s=driving_s + stop_s,
            departure_utc=req.departure_utc,
            arrival_utc=req.departure_utc + driving_s + stop_s,
            traffic_delay_s=s.route.traffic_delay_s,
            stops=tuple(stops),
            hos=hos,
        )

    # -- weather lookup budget -------------------------------------------------------------

    @staticmethod
    def _lookup_plan(
        req: PlanRequest, routes: Sequence[PlannedRoute], lattice_lines: Sequence[Sequence[LatLon]]
    ) -> _LookupPlan:
        checkpoints = {
            (r.id, interval): build_checkpoints(
                r.geom, interval, req.departure_utc, r.hos, anchors=r.anchors
            )
            for r in routes
            for interval in INTERVALS_MI
        }
        plan = _LookupPlan(checkpoints, choose_lattice(lattice_lines, min_k=MIN_STRIDE_K))
        # Budget guard (PLAN §5.4): coarsen the heatmap first, then checkpoint snapping.
        while len(plan.cells()) > MAX_LOCATIONS and plan.lattice.stride_k < MAX_HEATMAP_STRIDE_K:
            plan.lattice = choose_lattice(lattice_lines, min_k=plan.lattice.stride_k + 1)
            if "heatmap" not in plan.coarsened:
                plan.coarsened.append("heatmap")
        for intervals, name in (((25, 50), "checkpoints_25_50"), ((10,), "checkpoints_10")):
            if len(plan.cells()) <= MAX_LOCATIONS:
                break
            for (rid, interval), cps in plan.checkpoints.items():
                if interval in intervals:
                    plan.checkpoints[(rid, interval)] = [
                        dataclasses.replace(cp, lookup_cell=snap(cp.pos, COARSE_SNAP_DEG))
                        for cp in cps
                    ]
            plan.coarsened.append(name)
        return plan

    # -- the stream ------------------------------------------------------------------------

    def stream(self, req: PlanRequest) -> Iterator[PlanEvent]:
        deadline = time.monotonic() + TOTAL_BUDGET_S
        phase = self._route_phase(req)
        if not phase.selected:
            raise NoRouteError()
        compute_started = time.monotonic()
        routes = tuple(self._planned_route(req, i, s) for i, s in enumerate(phase.selected))
        self.timings.compute_ms += (time.monotonic() - compute_started) * 1000

        yield MetaEvent(departure_utc=req.departure_utc, origin_tz=req.origin_tz)
        yield RoutesEvent(routes=routes)

        compute_started = time.monotonic()
        lookup = self._lookup_plan(req, routes, phase.lattice_lines)
        cells = lookup.cells()
        now = clock.now_utc()
        last_eta = max(cps[-1].eta_utc for cps in lookup.checkpoints.values())
        start_utc, end_utc = weather_window(req.departure_utc, last_eta, now)
        self.timings.compute_ms += (time.monotonic() - compute_started) * 1000

        fetch_started = time.monotonic()
        fetch = self.weather.fetch(cells, start_utc, end_utc, deadline=deadline)
        while True:
            try:
                progress = next(fetch)
            except StopIteration as stop:
                weather: WeatherResult = stop.value
                break
            yield ProgressEvent(stage="weather", done=progress.done, total=progress.total)
        self.timings.openmeteo_ms += (time.monotonic() - fetch_started) * 1000

        compute_started = time.monotonic()
        plan = self._assemble(req, routes, lookup, weather, now, end_utc)
        self.timings.compute_ms += (time.monotonic() - compute_started) * 1000
        log.info(
            "plan routes=%d cells=%d cached=%d fetched=%d failed=%d %s",
            len(routes),
            len(cells),
            weather.cached,
            weather.fetched,
            len(weather.failed),
            self.timings.header(),
        )
        yield ResultEvent(plan=plan)

    def plan(self, req: PlanRequest) -> PlanResult:
        for event in self.stream(req):
            if isinstance(event, ResultEvent):
                return event.plan
        raise RuntimeError("planner finished without a result")  # pragma: no cover

    # -- assembly --------------------------------------------------------------------------

    def _assemble(
        self,
        req: PlanRequest,
        routes: Sequence[PlannedRoute],
        lookup: _LookupPlan,
        weather: WeatherResult,
        now_utc: float,
        window_end_utc: int,
    ) -> PlanResult:
        """Classify every checkpoint, aggregate, recommend per interval and encode the heatmap."""
        series = weather.series
        intervals: dict[str, dict[int, IntervalResult]] = {r.id: {} for r in routes}
        beyond_horizon = False
        for (rid, interval), cps in lookup.checkpoints.items():
            results = []
            for cp in cps:
                s = series.get(cp.lookup_cell)
                w = None if s is None else weather_at(s, cp.eta_utc)
                beyond_horizon = beyond_horizon or cp.eta_utc > window_end_utc
                results.append(
                    CheckpointResult(
                        checkpoint=cp,
                        tz=tz_at(cp.pos.lat, cp.pos.lon),
                        weather=w,
                        assessment=assess(w, req.load_weight_lb),
                    )
                )
            agg = aggregate([cp.owned_mi for cp in cps], [r.assessment for r in results])
            intervals[rid][interval] = IntervalResult(checkpoints=tuple(results), aggregates=agg)

        recommendation = {
            interval: recommend(
                [
                    RouteScore(r.id, i, intervals[r.id][interval].aggregates, r.duration_s)
                    for i, r in enumerate(routes)
                ]
            )
            for interval in INTERVALS_MI
        }
        frames = build_frames(lookup.lattice.cells, series, req.departure_utc, req.load_weight_lb)
        heatmap = encode_heatmap(frames, lookup.lattice.cell_deg)

        warnings = list(req.warnings)
        if len(routes) < ROUTES_TO_SHOW:
            n = len(routes)
            noun = "route exists" if n == 1 else "routes exist"
            warnings.append(
                PlanWarning("FEWER_THAN_3_ROUTES", f"Only {n} distinct truck {noun} for this trip.")
            )
        if weather.failed:
            warnings.append(
                PlanWarning(
                    "WEATHER_PARTIAL",
                    "Weather is missing for part of the corridor; those checkpoints show No data.",
                )
            )
        if beyond_horizon:
            warnings.append(
                PlanWarning(
                    "BEYOND_FORECAST_HORIZON",
                    "Part of the trip is past the 16-day forecast; those checkpoints show No data.",
                )
            )
        if lookup.coarsened:
            warnings.append(
                PlanWarning(
                    "WEATHER_COARSENED",
                    "This trip is long, so weather was sampled on a coarser grid ("
                    + ", ".join(lookup.coarsened)
                    + ").",
                )
            )
        return PlanResult(
            request=req,
            generated_at_utc=now_utc,
            routes=tuple(routes),
            intervals=intervals,
            recommendation=recommendation,
            heatmap=heatmap,
            warnings=tuple(warnings),
        )
