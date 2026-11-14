"""Wall clock for request validation and forecast horizons (patched in tests)."""

from __future__ import annotations

import time


def now_utc() -> float:
    return time.time()
