"""Plan payload budget (PLAN section 8): the heatmap and the whole plan are each <= 150 KB gzip.

Runs in fixture mode on every recorded trip, including Chicago to Denver (about 1,000 miles,
the size the budget was set for). Sizes are measured the way the client receives them: compact
JSON (the NDJSON encoding) compressed with gzip at the default level.

Fixture weather is replayed from one recorded batch, so it repeats and compresses better than
live weather would. The heatmap is therefore also held to the budget uncompressed, which bounds
it whatever the weather looks like.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Callable, Iterator
from typing import Any

import pytest
import respx

from trips.tests.api.conftest import plan_body

Api = Callable[..., Any]

BUDGET_BYTES = 150 * 1024

TRIPS = {
    "denver_slc": ((39.7392, -104.9903), (40.7608, -111.8910)),
    "chicago_denver": ((41.8781, -87.6298), (39.7392, -104.9903)),
    "dallas_albuquerque": ((32.7767, -96.7970), (35.0844, -106.6504)),
    "seattle_boise": ((47.6062, -122.3321), (43.6150, -116.2023)),
}


@pytest.fixture(autouse=True)
def _fixture_mode(settings: Any) -> Iterator[None]:
    settings.PLAN_FIXTURES = True
    settings.TOMTOM_API_KEY = ""
    with respx.mock(assert_all_mocked=True):  # any real HTTP call would fail
        yield


def compact(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode()


@pytest.mark.parametrize("trip", TRIPS)
def test_plan_payload_fits_the_budget(api: Api, trip: str) -> None:
    (olat, olon), (dlat, dlon) = TRIPS[trip]
    body = plan_body(
        origin={"label": "origin", "lat": olat, "lon": olon},
        destination={"label": "destination", "lat": dlat, "lon": dlon},
        apply_hos=True,  # adds the stops, the largest variant of the plan
    )
    response = api(body)
    assert response.status_code == 200
    plan = response.json()

    heatmap_raw = len(compact(plan["heatmap"]))
    heatmap_gzip = len(gzip.compress(compact(plan["heatmap"])))
    plan_gzip = len(gzip.compress(compact(plan)))
    assert heatmap_gzip <= BUDGET_BYTES, f"heatmap {heatmap_gzip} B gzip"
    assert heatmap_raw <= BUDGET_BYTES, f"heatmap {heatmap_raw} B uncompressed"
    assert plan_gzip <= BUDGET_BYTES, f"plan {plan_gzip} B gzip"
