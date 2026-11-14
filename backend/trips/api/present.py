"""Turn planner results into the JSON shapes of the api-contracts skill.

Plain functions over dataclasses: DRF serializers are far too slow for ~500 checkpoints per
plan, so they are used only for request validation and to document the schema.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

from trips.domain.attribution import Aggregates
from trips.domain.heatmap_grid import EncodedHeatmap
from trips.domain.levels import Level
from trips.domain.recommend import STEPS, Recommendation
from trips.domain.risk import (
    RAIN_EDGES_IN_HR,
    SNOW_EDGES_IN_HR,
    WIND_EDGES_MPH,
    band_level,
)
from trips.domain.types import Weather
from trips.services.planner import (
    CheckpointResult,
    IntervalResult,
    MetaEvent,
    PlanEvent,
    PlannedRoute,
    PlanResult,
    ProgressEvent,
    ResultEvent,
    RoutesEvent,
)

Json = dict[str, Any]


def iso_utc(t_utc: float) -> str:
    return dt.datetime.fromtimestamp(round(t_utc), tz=dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def display_value(
    value: float | None, ndigits: int, edges: tuple[float, ...], *, top_closed: bool
) -> float | None:
    """Round for display without moving the value into another risk band.

    34.96 mph is Moderate, but rounds to 35.0, which reads as High. In that case the value is
    nudged one unit back toward the raw value (34.9), so the number and its color agree.
    """
    if value is None or not math.isfinite(value):
        return None
    shown = round(value, ndigits)
    if band_level(shown, edges, top_closed=top_closed) == band_level(
        value, edges, top_closed=top_closed
    ):
        return shown
    step = 10.0**-ndigits
    return round(shown - step if shown > value else shown + step, ndigits)


def _round(value: float | None, ndigits: int) -> float | None:
    return None if value is None or not math.isfinite(value) else round(value, ndigits)


def weather_dict(w: Weather, cell: tuple[float, float]) -> Json:
    return {
        "wind_mph": display_value(w.wind_mph, 1, WIND_EDGES_MPH, top_closed=False),
        "gust_mph": _round(w.gust_mph, 1),
        "rain_in_hr": display_value(w.rain_in_hr, 3, RAIN_EDGES_IN_HR, top_closed=True),
        "snow_in_hr": display_value(w.snow_in_hr, 3, SNOW_EDGES_IN_HR, top_closed=True),
        "cell": [cell[0], cell[1]],
    }


def checkpoint_dict(r: CheckpointResult) -> Json:
    cp, a = r.checkpoint, r.assessment
    return {
        "mile": round(cp.mile, 2),
        "lat": round(cp.pos.lat, 5),
        "lon": round(cp.pos.lon, 5),
        "kind": cp.kind,
        "owned_mi": round(cp.owned_mi, 3),
        "eta_utc": iso_utc(cp.eta_utc),
        "tz": r.tz,
        "status": a.status,
        "weather": None if r.weather is None else weather_dict(r.weather, cp.lookup_cell),
        "level": None if a.level is None else a.level.name,
        "score": a.score,
        "levels": None
        if a.levels is None
        else {"wind": a.levels.wind.name, "rain": a.levels.rain.name, "snow": a.levels.snow.name},
        "triggers": [{"rule": t.rule, "detail": t.detail} for t in a.triggers],
    }


def aggregates_dict(agg: Aggregates) -> Json:
    miles = {level.name: round(agg.miles_by_level[level], 2) for level in Level}
    miles["NO_DATA"] = round(agg.no_data_mi, 2)
    return {
        "miles_by_level": miles,
        "avg_risk": _round(agg.avg_risk, 4),
        "max_level": None if agg.max_level is None else agg.max_level.name,
        "checkpoint_count": agg.checkpoint_count,
    }


def interval_dict(r: IntervalResult) -> Json:
    return {
        "checkpoints": [checkpoint_dict(c) for c in r.checkpoints],
        "aggregates": aggregates_dict(r.aggregates),
    }


def route_dict(r: PlannedRoute) -> Json:
    return {
        "id": r.id,
        "label": r.label,
        "source": r.source,
        "summary": {
            "distance_mi": round(r.distance_mi, 1),
            "duration_s": round(r.duration_s),
            "driving_s": round(r.driving_s),
            "hos_stop_s": round(r.hos_stop_s),
            "departure_utc": iso_utc(r.departure_utc),
            "arrival_utc": iso_utc(r.arrival_utc),
            "traffic_delay_s": round(r.traffic_delay_s),
        },
        "geometry": {"encoding": "polyline6", "value": r.polyline6},
        "stops": [
            {
                "kind": s.kind,
                "mile": round(s.mile, 2),
                "lat": round(s.pos.lat, 5),
                "lon": round(s.pos.lon, 5),
                "start_utc": iso_utc(s.start_utc),
                "duration_s": round(s.duration_s),
            }
            for s in r.stops
        ],
    }


def recommendation_dict(rec: Recommendation) -> Json:
    return {
        "route_id": rec.route_id,
        "ranking": list(rec.ranking),
        "all_no_travel": rec.all_no_travel,
        "steps": list(STEPS),
        "keys": {
            rid: [None if math.isinf(v) else v for v in key[: len(STEPS)]]
            for rid, key in rec.keys.items()
        },
        "decided_by": dict(rec.decided_by),
        "decisive_step": rec.decisive_step,
    }


def heatmap_dict(h: EncodedHeatmap) -> Json:
    return {
        "base_time_utc": iso_utc(h.base_time_utc),
        "hours": h.hours,
        "cell_deg": h.cell_deg,
        "count": h.count,
        "lat": list(h.lat),
        "lon": list(h.lon),
        "levels_b64": h.levels_b64,
        "wind_mph_x10_b64": h.wind_mph_x10_b64,
        "rain_in_hr_x1000_b64": h.rain_in_hr_x1000_b64,
        "snow_in_hr_x100_b64": h.snow_in_hr_x100_b64,
    }


def plan_dict(plan: PlanResult) -> Json:
    req = plan.request
    routes = []
    for r in plan.routes:
        d = route_dict(r)
        d["intervals"] = {str(i): interval_dict(res) for i, res in plan.intervals[r.id].items()}
        routes.append(d)
    return {
        "departure_utc": iso_utc(req.departure_utc),
        "origin_tz": req.origin_tz,
        "generated_at": iso_utc(plan.generated_at_utc),
        "load_weight_lb": req.load_weight_lb,
        "apply_hos": req.apply_hos,
        "routes": routes,
        "recommendation": {str(i): recommendation_dict(r) for i, r in plan.recommendation.items()},
        "heatmap": heatmap_dict(plan.heatmap),
        "warnings": [{"code": w.code, "message": w.message} for w in plan.warnings],
    }


def event_dict(event: PlanEvent) -> Json:
    match event:
        case MetaEvent():
            return {
                "type": "meta",
                "departure_utc": iso_utc(event.departure_utc),
                "origin_tz": event.origin_tz,
            }
        case RoutesEvent():
            return {"type": "routes", "routes": [route_dict(r) for r in event.routes]}
        case ProgressEvent():
            return {
                "type": "progress",
                "stage": event.stage,
                "done": event.done,
                "total": event.total,
            }
        case ResultEvent():
            return {"type": "result", "plan": plan_dict(event.plan)}
