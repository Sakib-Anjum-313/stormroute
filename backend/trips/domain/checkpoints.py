"""Checkpoints for one route and interval: resample, attribute miles, attach ETAs and cells."""

from __future__ import annotations

from collections.abc import Sequence

from trips.domain.attribution import owned_miles
from trips.domain.eta import TimeAnchors, driving_s_at, time_anchors
from trips.domain.geometry import METERS_PER_MILE, snap
from trips.domain.hos import Stop, stop_time_before_s
from trips.domain.resample import resample
from trips.domain.types import Checkpoint, RouteGeom


def build_checkpoints(
    geom: RouteGeom,
    interval_mi: float,
    departure_utc: float,
    stops: Sequence[Stop] = (),
    *,
    snap_deg: float = 0.1,
    anchors: TimeAnchors | None = None,
) -> list[Checkpoint]:
    """``eta_utc = departure_utc + driving_s + stop time taken before driving_s``."""
    anchors = anchors or time_anchors(geom)
    samples = resample(geom, interval_mi)
    owned = owned_miles([s.mile for s in samples], geom.length_m / METERS_PER_MILE)
    out: list[Checkpoint] = []
    for sample, owned_mi in zip(samples, owned, strict=True):
        driving_s = driving_s_at(anchors, sample.distance_m)
        out.append(
            Checkpoint(
                mile=sample.mile,
                distance_m=sample.distance_m,
                pos=sample.pos,
                kind=sample.kind,
                owned_mi=owned_mi,
                driving_s=driving_s,
                eta_utc=departure_utc + driving_s + stop_time_before_s(stops, driving_s),
                lookup_cell=snap(sample.pos, snap_deg),
            )
        )
    return out
