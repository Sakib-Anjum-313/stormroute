"""Client-side rate limiting and retry backoff for upstream APIs.

Open-Meteo counts every location in a multi-location request as one call (600/min on the free
tier), so the token bucket is denominated in locations, not requests.
"""

from __future__ import annotations

import math
import random
import threading
import time
from collections.abc import Callable, Iterator, Sequence

from trips.services.errors import UpstreamRateLimitedError

Clock = Callable[[], float]


class TokenBucket:
    """A thread-safe token bucket: ``capacity`` tokens, refilled continuously over ``period_s``."""

    def __init__(
        self,
        capacity: float,
        period_s: float = 60.0,
        *,
        clock: Clock = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if capacity <= 0 or period_s <= 0:
            raise ValueError("capacity and period_s must be positive")
        self.capacity = float(capacity)
        self.rate_per_s = capacity / period_s
        self._tokens = float(capacity)
        self._clock = clock
        self._sleep = sleep
        self._updated = clock()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = self._clock()
        self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate_per_s)
        self._updated = now

    @property
    def tokens(self) -> float:
        with self._lock:
            self._refill()
            return self._tokens

    def acquire(self, n: float, *, max_wait_s: float) -> None:
        """Take ``n`` tokens, waiting for the refill if needed.

        Raises ``UpstreamRateLimitedError`` (with the wait as ``retry_after_s``) instead of waiting
        longer than ``max_wait_s``. Tokens are reserved before sleeping, so concurrent callers
        queue fairly instead of all waking at once.
        """
        if n > self.capacity:
            raise ValueError("cannot acquire more tokens than the bucket holds")
        with self._lock:
            self._refill()
            wait = max(0.0, (n - self._tokens) / self.rate_per_s)
            if wait > max_wait_s:
                raise UpstreamRateLimitedError(retry_after_s=max(1, math.ceil(wait)))
            self._tokens -= n
        if wait > 0:
            self._sleep(wait)

    def observe_remaining(self, remaining: float) -> None:
        """Lower our estimate to the server's ``x-ratelimit-remaining`` (the IP may be shared)."""
        with self._lock:
            self._refill()
            self._tokens = min(self._tokens, max(0.0, remaining))


def backoff_delays(base_delays_s: Sequence[float], *, jitter: float = 0.25) -> Iterator[float]:
    """Delays before each retry, each scaled by a random factor in ``[1 - jitter, 1 + jitter]``."""
    for delay in base_delays_s:
        yield max(0.0, delay * random.uniform(1 - jitter, 1 + jitter))
