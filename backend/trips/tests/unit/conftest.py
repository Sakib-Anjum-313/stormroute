from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import pytest

from trips.domain.resample import route_geom
from trips.domain.types import LatLon, ProgressEntry, RouteGeom

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def load_tomtom(name: str) -> dict[str, Any]:
    with gzip.open(FIXTURES / "tomtom" / f"{name}.json.gz", "rt") as fh:
        data: dict[str, Any] = json.load(fh)
    return data


def geoms_from_tomtom(data: dict[str, Any]) -> list[RouteGeom]:
    geoms = []
    for route in data["response"]["routes"]:
        points = [
            LatLon(p["latitude"], p["longitude"]) for leg in route["legs"] for p in leg["points"]
        ]
        progress = [
            ProgressEntry(e["pointIndex"], e["distanceInMeters"], e["travelTimeInSeconds"])
            for e in route["progress"]
        ]
        summary = route["summary"]
        geoms.append(
            route_geom(points, summary["lengthInMeters"], summary["travelTimeInSeconds"], progress)
        )
    return geoms


@pytest.fixture(scope="session")
def denver_slc_raw() -> dict[str, Any]:
    return load_tomtom("denver_slc")


@pytest.fixture(scope="session")
def denver_slc(denver_slc_raw: dict[str, Any]) -> list[RouteGeom]:
    return geoms_from_tomtom(denver_slc_raw)


def straight_route(
    lat: float = 40.0,
    lon0: float = -105.0,
    lon1: float = -104.0,
    n: int = 101,
    duration_s: float = 3600.0,
) -> RouteGeom:
    """An east-west polyline at constant latitude with ``n`` evenly spaced vertices."""
    from trips.domain.geometry import cumulative_m

    points = [LatLon(lat, lon0 + (lon1 - lon0) * i / (n - 1)) for i in range(n)]
    length = cumulative_m(points)[-1]
    progress = [ProgressEntry(0, 0.0, 0.0), ProgressEntry(n - 1, length, duration_s)]
    return route_geom(points, length, duration_s, progress)
