"""Weather lookup planning: one time window per plan, cell dedupe and the location budget.

Checkpoint positions snap to a 0.1° lattice (``geometry.snap``) and heatmap cells sit on a
coarser multiple of 0.1°, so they share cache entries. Open-Meteo bills per location, so the
planner keeps each plan under ``MAX_LOCATIONS`` unique cells (PLAN §5.4).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Protocol

from trips.domain.timealign import HOUR_S, ceil_hour, floor_hour
from trips.domain.types import Cell
from trips.services.openmeteo import WeatherFetch

MAX_LOCATIONS = 550
HEATMAP_HOURS = 48
FORECAST_DAYS = 16


class WeatherProvider(Protocol):
    def fetch(
        self, cells: Sequence[Cell], start_utc: int, end_utc: int, *, deadline: float
    ) -> WeatherFetch: ...


def forecast_end_utc(now_utc: float) -> int:
    """The last hour Open-Meteo forecasts (16 days from today, hour-aligned)."""
    return floor_hour(now_utc) + FORECAST_DAYS * 24 * HOUR_S - HOUR_S


def weather_window(departure_utc: float, last_eta_utc: float, now_utc: float) -> tuple[int, int]:
    """``[floor_hour(T0) - 1 h, ceil_hour(max(last ETA, T0 + 48 h)) + 1 h]``, inclusive hours.

    The end is clamped to the forecast horizon. Times past it read as missing (NO_DATA).
    """
    t0 = floor_hour(departure_utc)
    start = t0 - HOUR_S
    end = ceil_hour(max(last_eta_utc, t0 + HEATMAP_HOURS * HOUR_S)) + HOUR_S
    return start, max(start, min(end, forecast_end_utc(now_utc)))


def unique_cells(groups: Iterable[Iterable[Cell]]) -> list[Cell]:
    """Order-preserving union of cells."""
    seen: dict[Cell, None] = {}
    for group in groups:
        for cell in group:
            seen.setdefault(cell, None)
    return list(seen)
