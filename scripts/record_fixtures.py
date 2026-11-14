"""Record TomTom + Open-Meteo responses as test fixtures and print an API fact report.

Usage (from repo root):
    uv run --directory backend python ../scripts/record_fixtures.py            # TomTom + Open-Meteo
    uv run --directory backend python ../scripts/record_fixtures.py --only openmeteo

Reads TOMTOM_API_KEY from backend/.env (never printed). Fixtures are written gzipped to
backend/trips/tests/fixtures/{tomtom,openmeteo}/ with the API key scrubbed.

Open-Meteo counts every location in a batch against its 600/min free quota, so this script
records at most one 100-location batch per run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import environ
import httpx

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "backend" / "trips" / "tests" / "fixtures"
EARTH_RADIUS_M = 6_371_008.8
LB_TO_KG = 0.45359237

# Candidate demo trips (see PLAN.md section 15). Coordinates are city centers.
TRIPS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    "denver_slc": ((39.7392, -104.9903), (40.7608, -111.8910)),
    "chicago_denver": ((41.8781, -87.6298), (39.7392, -104.9903)),
    "seattle_boise": ((47.6062, -122.3321), (43.6150, -116.2023)),
    "dallas_albuquerque": ((32.7767, -96.7970), (35.0844, -106.6504)),
}
LOAD_WEIGHT_LB = 45_000


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def write_gz(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB gz)")


def route_points(route: dict[str, Any]) -> list[tuple[float, float]]:
    return [(p["latitude"], p["longitude"]) for leg in route["legs"] for p in leg["points"]]


def resample(points: list[tuple[float, float]], step_m: float) -> list[tuple[float, float]]:
    """Points every step_m along the polyline (linear in lat/lon within a segment)."""
    out = [points[0]]
    carry = 0.0
    for a, b in zip(points, points[1:], strict=False):
        seg = haversine_m(a, b)
        while carry + seg >= step_m and seg > 0:
            f = (step_m - carry) / seg
            a = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
            seg = haversine_m(a, b)
            carry = 0.0
            out.append(a)
        carry += seg
    out.append(points[-1])
    return out


def overlap_share(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> float:
    """Share of a's 1-mile samples lying within 300 m of b's 200 m samples (grid-hashed)."""
    cell = 0.01  # about 1 km
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for p in resample(b, 200):
        grid.setdefault((int(p[0] / cell), int(p[1] / cell)), []).append(p)
    samples = resample(a, 1609.344)
    hits = 0
    for p in samples:
        gi, gj = int(p[0] / cell), int(p[1] / cell)
        near = (
            q
            for di in (-1, 0, 1)
            for dj in (-1, 0, 1)
            for q in grid.get((gi + di, gj + dj), [])
        )
        if any(haversine_m(p, q) <= 300 for q in near):
            hits += 1
    return hits / len(samples)


def record_tomtom(client: httpx.Client, key: str) -> None:
    depart = (dt.datetime.now(dt.UTC) + dt.timedelta(hours=1)).replace(microsecond=0)
    params: list[tuple[str, str | int]] = [
        ("key", key),
        ("travelMode", "truck"),
        ("vehicleWeight", round(LOAD_WEIGHT_LB * LB_TO_KG)),
        ("vehicleCommercial", "true"),
        ("maxAlternatives", 4),
        ("alternativeType", "anyRoute"),
        ("routeType", "fastest"),
        ("traffic", "true"),
        ("departAt", depart.isoformat().replace("+00:00", "Z")),
        ("computeTravelTimeFor", "all"),
        ("extendedRouteRepresentation", "distance"),
        ("extendedRouteRepresentation", "travelTime"),
    ]
    for slug, (o, d) in TRIPS.items():
        url = (
            "https://api.tomtom.com/routing/1/calculateRoute/"
            f"{o[0]},{o[1]}:{d[0]},{d[1]}/json"
        )
        resp = client.get(url, params=params, timeout=30)
        print(f"\n[tomtom] {slug}: HTTP {resp.status_code}  qps-headers="
              f"{ {k: v for k, v in resp.headers.items() if 'rate' in k.lower() or 'qps' in k.lower()} }")
        body = resp.json()
        if resp.status_code != 200:
            print("  error:", json.dumps(body.get("detailedError", body))[:300])
            continue
        routes = body["routes"]
        polys = [route_points(r) for r in routes]
        for i, r in enumerate(routes):
            s = r["summary"]
            prog = r.get("progress", [])
            print(
                f"  route {i}: {s['lengthInMeters'] / 1609.344:7.1f} mi  "
                f"{s['travelTimeInSeconds'] / 3600:5.2f} h  points={len(polys[i]):6d}  "
                f"progress_entries={len(prog):6d}  first={prog[:1]}  last={prog[-1:]}"
            )
        for i in range(len(polys)):
            shares = [f"{overlap_share(polys[i], polys[j]):.2f}" if i != j else " -- "
                      for j in range(len(polys))]
            print(f"  overlap[{i}] vs others: {shares}")
        body.pop("formatVersion", None)
        write_gz(FIXTURES / "tomtom" / f"{slug}.json.gz",
                 {"request": {"origin": o, "destination": d, "depart_at": depart.isoformat(),
                              "load_weight_lb": LOAD_WEIGHT_LB}, "response": body})


def record_openmeteo(client: httpx.Client) -> None:
    src = FIXTURES / "tomtom" / "denver_slc.json.gz"
    if src.exists():
        with gzip.open(src, "rt") as fh:
            route = json.load(fh)["response"]["routes"][0]
        pts = resample(route_points(route), 10 * 1609.344)
        origin = "denver_slc route A, 10-mile marks"
    else:
        o, d = TRIPS["denver_slc"]
        pts = [(o[0] + (d[0] - o[0]) * k / 99, o[1] + (d[1] - o[1]) * k / 99) for k in range(100)]
        origin = "denver_slc straight line"
    snapped = sorted({(round(p[0], 1), round(p[1], 1)) for p in pts})[:100]
    start = dt.datetime.now(dt.UTC).replace(minute=0, second=0, microsecond=0)
    end = start + dt.timedelta(hours=72)
    form = {
        "latitude": ",".join(f"{p[0]:.1f}" for p in snapped),
        "longitude": ",".join(f"{p[1]:.1f}" for p in snapped),
        "hourly": "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timeformat": "unixtime",
        "timezone": "GMT",
        "start_hour": start.strftime("%Y-%m-%dT%H:%M"),
        "end_hour": end.strftime("%Y-%m-%dT%H:%M"),
    }
    resp = client.post("https://api.open-meteo.com/v1/forecast", data=form, timeout=30)
    rl = {k: v for k, v in resp.headers.items() if k.lower().startswith("x-ratelimit")}
    print(f"\n[open-meteo] {origin}: {len(pts)} marks -> {len(snapped)} unique 0.1° cells, "
          f"HTTP {resp.status_code}, {len(resp.content) / 1024:.0f} KB, {rl}")
    if resp.status_code != 200:
        print("  error:", resp.text[:300])
        return
    body = resp.json()
    first = body[0] if isinstance(body, list) else body
    print(f"  units={first['hourly_units']}  hours={len(first['hourly']['time'])}")
    nulls = sum(v is None for loc in body for k, vs in loc["hourly"].items() if k != "time" for v in vs)
    print(f"  null values: {nulls}")
    write_gz(FIXTURES / "openmeteo" / "denver_slc_100.json.gz", {"request": form, "response": body})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["tomtom", "openmeteo"])
    args = parser.parse_args()
    environ.Env.read_env(ROOT / "backend" / ".env", overwrite=False)
    with httpx.Client(headers={"User-Agent": "spotter-assessment-fixture-recorder"}) as client:
        if args.only in (None, "tomtom"):
            key = os.environ.get("TOMTOM_API_KEY", "")
            if not key:
                print("TOMTOM_API_KEY missing in backend/.env; skipping TomTom.", file=sys.stderr)
                if args.only == "tomtom":
                    return 1
            else:
                record_tomtom(client, key)
        if args.only in (None, "openmeteo"):
            record_openmeteo(client)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
