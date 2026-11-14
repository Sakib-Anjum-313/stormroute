"""Corridor heatmap lattice, 49 hourly frames and binary encoding (PLAN §5.7).

- Lattice stride ``s = 0.1° x k`` with ``k`` starting at 2: the smallest ``k`` whose corridor has
  at most 250 cells. Strides are multiples of 0.1°, so heatmap cells share the weather cache
  with checkpoint cells.
- Corridor = lattice points in the routes' bounding box ± buffer whose distance to any route is
  at most ``max(0.75 x s x 111 km, 20 km)``.
- Frame ``h`` is at ``T0 + h hours`` with ``T0 = floor_hour(departure_utc)`` and uses the same
  ``weather_at`` and ``assess`` as the checkpoints.
- Encoding is frame-major (``idx = h * count + i``): levels as Uint8 (255 = no data) and windx10,
  rainx1000, snowx100 as little-endian Uint16 (65535 = no data), each base64-encoded.
"""

from __future__ import annotations

import base64
import math
import struct
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from trips.domain.geometry import METERS_PER_DEGREE, PolylineIndex
from trips.domain.risk import assess
from trips.domain.timealign import HOUR_S, floor_hour, weather_at
from trips.domain.types import Cell, LatLon, LocationSeries

MAX_CELLS = 250
MIN_STRIDE_K = 2
MAX_STRIDE_K = 50
"""Safety stop for the stride search (5°); far beyond any real corridor."""
HOURS = 49
"""Frames 0..48 inclusive."""
MIN_RADIUS_M = 20_000.0
RADIUS_STRIDE_FACTOR = 0.75
KM_PER_DEGREE = 111.0

LEVEL_NO_DATA = 255
U16_NO_DATA = 65535
U16_MAX_VALUE = 65534
WIND_SCALE = 10
RAIN_SCALE = 1000
SNOW_SCALE = 100


def corridor_radius_m(stride_deg: float) -> float:
    return max(RADIUS_STRIDE_FACTOR * stride_deg * KM_PER_DEGREE * 1000.0, MIN_RADIUS_M)


def corridor_cells(polylines: Sequence[Sequence[LatLon]], stride_k: int) -> list[Cell]:
    """Lattice cells (stride ``0.1° x stride_k``) within the corridor radius of any polyline."""
    points = [p for line in polylines for p in line]
    if not points:
        return []
    stride = stride_k / 10
    radius_m = corridor_radius_m(stride)
    max_abs_lat = max(abs(p.lat) for p in points)
    cos_lat = max(0.01, math.cos(math.radians(min(89.0, max_abs_lat))))
    buf_lat = radius_m / METERS_PER_DEGREE
    buf_lon = buf_lat / cos_lat
    lat_lo = math.ceil((min(p.lat for p in points) - buf_lat) * 10 / stride_k)
    lat_hi = math.floor((max(p.lat for p in points) + buf_lat) * 10 / stride_k)
    lon_lo = math.ceil((min(p.lon for p in points) - buf_lon) * 10 / stride_k)
    lon_hi = math.floor((max(p.lon for p in points) + buf_lon) * 10 / stride_k)
    index = PolylineIndex(polylines, radius_m)
    cells: list[Cell] = []
    for i in range(lat_lo, lat_hi + 1):
        lat = round(i * stride_k / 10, 1)
        for j in range(lon_lo, lon_hi + 1):
            lon = round(j * stride_k / 10, 1)
            if index.within(LatLon(lat, lon), radius_m):
                cells.append((lat, lon))
    return cells


@dataclass(frozen=True, slots=True)
class Lattice:
    stride_k: int
    cells: tuple[Cell, ...]

    @property
    def cell_deg(self) -> float:
        return self.stride_k / 10


def choose_lattice(
    polylines: Sequence[Sequence[LatLon]],
    max_cells: int = MAX_CELLS,
    min_k: int = MIN_STRIDE_K,
) -> Lattice:
    """The smallest stride ``k >= min_k`` whose corridor has at most ``max_cells`` cells."""
    for k in range(min_k, MAX_STRIDE_K + 1):
        cells = corridor_cells(polylines, k)
        if len(cells) <= max_cells:
            return Lattice(stride_k=k, cells=tuple(cells))
    raise ValueError("corridor too large for the heatmap cell cap")


@dataclass(frozen=True, slots=True)
class HeatmapFrames:
    """Frame-major arrays: index ``h * count + i`` for hour ``h`` and cell ``i``."""

    base_time_utc: int
    hours: int
    cells: tuple[Cell, ...]
    levels: tuple[int, ...]
    wind_mph: tuple[float | None, ...]
    rain_in_hr: tuple[float | None, ...]
    snow_in_hr: tuple[float | None, ...]


def build_frames(
    cells: Sequence[Cell],
    series_by_cell: Mapping[Cell, LocationSeries],
    departure_utc: float,
    weight_lb: float,
    hours: int = HOURS,
) -> HeatmapFrames:
    base = floor_hour(departure_utc)
    levels: list[int] = []
    wind: list[float | None] = []
    rain: list[float | None] = []
    snow: list[float | None] = []
    for h in range(hours):
        t = base + h * HOUR_S
        for cell in cells:
            series = series_by_cell.get(cell)
            if series is None:
                levels.append(LEVEL_NO_DATA)
                wind.append(None)
                rain.append(None)
                snow.append(None)
                continue
            w = weather_at(series, t)
            a = assess(w, weight_lb)
            levels.append(LEVEL_NO_DATA if a.level is None else int(a.level))
            wind.append(w.wind_mph)
            rain.append(w.rain_in_hr)
            snow.append(w.snow_in_hr)
    return HeatmapFrames(
        base_time_utc=base,
        hours=hours,
        cells=tuple(cells),
        levels=tuple(levels),
        wind_mph=tuple(wind),
        rain_in_hr=tuple(rain),
        snow_in_hr=tuple(snow),
    )


def encode_u8(values: Sequence[int]) -> str:
    return base64.b64encode(bytes(values)).decode("ascii")


def quantize_u16(value: float | None, scale: int) -> int:
    if value is None or not math.isfinite(value):
        return U16_NO_DATA
    return min(U16_MAX_VALUE, max(0, round(value * scale)))


def encode_u16(values: Sequence[float | None], scale: int) -> str:
    packed = struct.pack(f"<{len(values)}H", *(quantize_u16(v, scale) for v in values))
    return base64.b64encode(packed).decode("ascii")


@dataclass(frozen=True, slots=True)
class EncodedHeatmap:
    base_time_utc: int
    hours: int
    cell_deg: float
    count: int
    lat: tuple[float, ...]
    lon: tuple[float, ...]
    levels_b64: str
    wind_mph_x10_b64: str
    rain_in_hr_x1000_b64: str
    snow_in_hr_x100_b64: str


def encode_heatmap(frames: HeatmapFrames, cell_deg: float) -> EncodedHeatmap:
    return EncodedHeatmap(
        base_time_utc=frames.base_time_utc,
        hours=frames.hours,
        cell_deg=cell_deg,
        count=len(frames.cells),
        lat=tuple(c[0] for c in frames.cells),
        lon=tuple(c[1] for c in frames.cells),
        levels_b64=encode_u8(frames.levels),
        wind_mph_x10_b64=encode_u16(frames.wind_mph, WIND_SCALE),
        rain_in_hr_x1000_b64=encode_u16(frames.rain_in_hr, RAIN_SCALE),
        snow_in_hr_x100_b64=encode_u16(frames.snow_in_hr, SNOW_SCALE),
    )
