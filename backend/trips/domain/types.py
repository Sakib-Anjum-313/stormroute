"""Value types shared across the pure domain layer.

All types are frozen dataclasses. Units are in the field names; time is UTC epoch seconds.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

CheckpointKind = Literal["origin", "interval", "destination"]
Cell = tuple[float, float]
"""A weather-lookup lattice cell as ``(lat, lon)`` in degrees, already snapped."""


@dataclass(frozen=True, slots=True)
class LatLon:
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class ProgressEntry:
    """One TomTom ``progress[]`` entry: cumulative distance and travel time at a vertex."""

    point_index: int
    distance_m: float
    travel_time_s: float


@dataclass(frozen=True, slots=True)
class RouteGeom:
    """A route polyline with cumulative distance normalized to the provider's length.

    ``cum_m[0] == 0`` and ``cum_m[-1] == length_m`` exactly (see ``resample.route_geom``).
    """

    points: tuple[LatLon, ...]
    cum_m: tuple[float, ...]
    length_m: float
    duration_s: float
    progress: tuple[ProgressEntry, ...]


@dataclass(frozen=True, slots=True)
class Sample:
    """A point on a route at a given distance from the origin (output of resampling)."""

    distance_m: float
    mile: float
    pos: LatLon
    kind: CheckpointKind


@dataclass(frozen=True, slots=True)
class Checkpoint:
    """A sample with its owned miles, timing and weather-lookup cell."""

    mile: float
    distance_m: float
    pos: LatLon
    kind: CheckpointKind
    owned_mi: float
    driving_s: float
    eta_utc: float
    lookup_cell: Cell


@dataclass(frozen=True, slots=True)
class Weather:
    """Weather at one place and instant. ``None`` means the provider had no value."""

    wind_mph: float | None
    gust_mph: float | None
    rain_in_hr: float | None
    snow_in_hr: float | None


@dataclass(frozen=True, slots=True)
class HourlySeries:
    """Hourly values starting at ``start_utc`` (hour-aligned), one value per hour."""

    start_utc: int
    values: tuple[float | None, ...]


@dataclass(frozen=True, slots=True)
class LocationSeries:
    """Open-Meteo hourly series for one lattice cell, already in mph and in/hr."""

    wind_mph: HourlySeries
    gust_mph: HourlySeries
    rain_in_hr: HourlySeries
    showers_in_hr: HourlySeries
    snow_in_hr: HourlySeries
