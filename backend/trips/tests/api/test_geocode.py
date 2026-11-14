"""GET /api/geocode against a respx-mocked TomTom Fuzzy Search."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from django.test import Client

from trips.tests.api.conftest import SECRET_KEY, Upstreams

DENVER_RESULTS = {
    "summary": {"query": "denv", "numResults": 2},
    "results": [
        {
            "type": "Geography",
            "address": {"freeformAddress": "Denver, CO"},
            "position": {"lat": 39.74001, "lon": -104.99202},
        },
        {
            "type": "Street",
            "address": {"freeformAddress": "Denver Ave, Tulsa, OK 74103"},
            "position": {"lat": 36.15, "lon": -95.99},
        },
    ],
}


def test_geocode_returns_labels_and_coordinates(client: Client, upstreams: Upstreams) -> None:
    upstreams.search.mock(return_value=httpx.Response(200, json=DENVER_RESULTS))

    response = client.get("/api/geocode", {"q": "denv", "limit": "2"})

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {"label": "Denver, CO", "lat": 39.74001, "lon": -104.99202, "kind": "Geo"},
            {"label": "Denver Ave, Tulsa, OK 74103", "lat": 36.15, "lon": -95.99, "kind": "Str"},
        ]
    }
    request = upstreams.search.calls[0].request
    assert request.url.path == "/search/2/search/denv.json"
    params = httpx.QueryParams(request.url.query)
    assert params["typeahead"] == "true"
    assert params["countrySet"] == "US,CA,MX"
    assert params["limit"] == "2"
    assert SECRET_KEY not in response.content.decode()


def test_geocode_is_cached_per_normalized_query(client: Client, upstreams: Upstreams) -> None:
    upstreams.search.mock(return_value=httpx.Response(200, json=DENVER_RESULTS))

    client.get("/api/geocode", {"q": "Denv"})
    client.get("/api/geocode", {"q": "  denv "})

    assert upstreams.search.call_count == 1


def test_zero_matches_is_200_with_empty_results(client: Client, upstreams: Upstreams) -> None:
    upstreams.search.mock(return_value=httpx.Response(200, json={"results": []}))

    response = client.get("/api/geocode", {"q": "xyzzy"})

    assert response.status_code == 200
    assert response.json() == {"results": []}


@pytest.mark.parametrize("params", [{"q": "de"}, {}, {"q": "denver", "limit": 0}, {"q": "d" * 121}])
def test_bad_queries_are_400(client: Client, upstreams: Upstreams, params: dict[str, Any]) -> None:
    response = client.get("/api/geocode", params)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"
    assert upstreams.search.call_count == 0


@pytest.mark.parametrize(
    ("upstream", "status", "code"),
    [
        (httpx.Response(429), 503, "UPSTREAM_RATE_LIMITED"),
        (httpx.Response(500), 502, "UPSTREAM_UNAVAILABLE"),
        (httpx.Response(403, text="Developer Inactive"), 502, "UPSTREAM_UNAVAILABLE"),
        (
            httpx.Response(200, json={"results": [{"type": "Geography"}]}),
            502,
            "UPSTREAM_UNAVAILABLE",
        ),
    ],
)
def test_upstream_failures_map_to_the_error_table(
    client: Client, upstreams: Upstreams, upstream: httpx.Response, status: int, code: str
) -> None:
    upstreams.search.mock(return_value=upstream)

    response = client.get("/api/geocode", {"q": "denver"})

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_geocode_throttle_allows_60_per_minute(client: Client, upstreams: Upstreams) -> None:
    upstreams.search.mock(return_value=httpx.Response(200, json={"results": []}))
    statuses = [client.get("/api/geocode", {"q": f"query{i}"}).status_code for i in range(61)]
    assert statuses[:60] == [200] * 60
    assert statuses[60] == 429


def test_unknown_api_path_is_json_404(client: Client, settings: Any) -> None:
    settings.DEBUG = False
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "VALIDATION"
