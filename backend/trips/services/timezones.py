"""IANA time zones for coordinates (timezonefinder), cached per 0.1° cell."""

from __future__ import annotations

import functools
import threading

from timezonefinder import TimezoneFinder

_finder: TimezoneFinder | None = None
_lock = threading.Lock()


def _get_finder() -> TimezoneFinder:
    global _finder
    with _lock:
        if _finder is None:
            _finder = TimezoneFinder()
        return _finder


@functools.lru_cache(maxsize=8192)
def _tz_at_cell(lat_x100: int, lon_x100: int) -> str:
    name = _get_finder().timezone_at(lat=lat_x100 / 100, lng=lon_x100 / 100)
    return name if isinstance(name, str) and name else "UTC"


def tz_at(lat: float, lon: float) -> str:
    """Time zone name at a point (0.01° resolution; ``UTC`` when none is found)."""
    return _tz_at_cell(round(lat * 100), round(lon * 100))
