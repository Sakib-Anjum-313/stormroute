"""Via-point detours used when fewer than 3 distinct truck routes exist (PLAN §2.1 S10).

The via points sit on either side of the primary route's midpoint, offset perpendicular to the
straight origin-destination line by ``clamp(15% x straight-line distance, 20 km, 150 km)``.
A detour is accepted by the planner only if it is distinct from the kept routes and takes at
most 1.5x the fastest duration.
"""

from __future__ import annotations

import math

from trips.domain.geometry import METERS_PER_DEGREE, haversine_m
from trips.domain.resample import position_at
from trips.domain.types import LatLon, RouteGeom

OFFSET_SHARE = 0.15
MIN_OFFSET_M = 20_000.0
MAX_OFFSET_M = 150_000.0
MAX_DURATION_RATIO = 1.5


def detour_offset_m(origin: LatLon, destination: LatLon) -> float:
    straight = haversine_m(origin, destination)
    return min(MAX_OFFSET_M, max(MIN_OFFSET_M, OFFSET_SHARE * straight))


def detour_vias(primary: RouteGeom, origin: LatLon, destination: LatLon) -> tuple[LatLon, LatLon]:
    """Left and right via points around the primary route's midpoint (by distance).

    The perpendicular is taken to the straight origin-destination bearing in a local
    equirectangular projection, which is accurate enough for a routing hint.
    """
    mid = position_at(primary, primary.length_m / 2)
    cos_lat = math.cos(math.radians(mid.lat))
    dx = (destination.lon - origin.lon) * cos_lat
    dy = destination.lat - origin.lat
    norm = math.hypot(dx, dy)
    if norm == 0:
        raise ValueError("origin and destination coincide")
    # Unit normal (rotate the bearing 90 degrees counter-clockwise), in degrees of latitude.
    nx, ny = -dy / norm, dx / norm
    offset_deg = detour_offset_m(origin, destination) / METERS_PER_DEGREE
    left = LatLon(mid.lat + ny * offset_deg, mid.lon + nx * offset_deg / cos_lat)
    right = LatLon(mid.lat - ny * offset_deg, mid.lon - nx * offset_deg / cos_lat)
    return left, right


def detour_acceptable(duration_s: float, fastest_s: float) -> bool:
    return duration_s <= MAX_DURATION_RATIO * fastest_s
