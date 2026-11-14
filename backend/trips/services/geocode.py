"""Place search for the trip form (TomTom Fuzzy Search, typeahead), cached for 24 h."""

from __future__ import annotations

import hashlib
from typing import Protocol

from django.core.cache import cache

from trips.services.tomtom import Place

CACHE_TTL_S = 24 * 60 * 60
MIN_QUERY_LEN = 3


class PlaceSearch(Protocol):
    def fuzzy_search(self, query: str, limit: int) -> list[Place]: ...


def normalize_query(query: str) -> str:
    return " ".join(query.split()).casefold()


def geocode(
    provider: PlaceSearch, query: str, limit: int, *, namespace: str = "live"
) -> list[Place]:
    """Matches for ``query`` (already validated to be at least 3 characters)."""
    norm = normalize_query(query)
    digest = hashlib.sha256(norm.encode()).hexdigest()[:24]
    key = f"geocode:v1:{namespace}:{limit}:{digest}"
    cached: list[Place] | None = cache.get(key)
    if cached is not None:
        return cached
    results = provider.fuzzy_search(norm, limit)
    cache.set(key, results, CACHE_TTL_S)
    return results
