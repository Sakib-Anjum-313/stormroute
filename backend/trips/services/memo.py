"""A small thread-safe in-process LRU with expiry.

Used for results that are expensive to compute but costly to pickle into the Django cache
(for example the selected and simplified routes of a trip, about 50k coordinate objects).
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable


class TTLMemo[T]:
    def __init__(
        self, ttl_s: float, max_entries: int, *, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.ttl_s = ttl_s
        self.max_entries = max_entries
        self._clock = clock
        self._data: OrderedDict[str, tuple[float, T]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> T | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires <= self._clock():
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: str, value: T) -> None:
        with self._lock:
            self._data[key] = (self._clock() + self.ttl_s, value)
            self._data.move_to_end(key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
