"""Post-deploy smoke test for the Render deployment (docs/DEPLOY.md section 4.1).

Usage (from repo root):
    uv run --directory backend python ../scripts/smoke_deploy.py \
        --api https://stormroute-api-phi1.onrender.com --web https://stormroute-web.onrender.com

Runs read-only checks plus two plan requests (about 2 TomTom calls and a few hundred Open-Meteo
locations, then cache hits). Exits non-zero if any check fails. Never prints secrets.
"""

from __future__ import annotations

import argparse
import datetime as dt
import itertools
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from zoneinfo import ZoneInfo

import httpx

DENVER = ZoneInfo("America/Denver")
COLD_START_TIMEOUT_S = 120
# The API allows 10 plans/min per IP and this script sends 3, so a run soon after another run
# (or after using the app) can hit 429. Wait out Retry-After instead of reporting a failure.
MAX_RETRY_WAIT_S = 65


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def demo_request() -> dict[str, object]:
    tomorrow = dt.datetime.now(DENVER).date() + dt.timedelta(days=1)
    return {
        "origin": {"label": "Denver, CO, USA", "lat": 39.7392, "lon": -104.9903},
        "destination": {"label": "Salt Lake City, UT, USA", "lat": 40.7608, "lon": -111.8910},
        "departure_local": f"{tomorrow.isoformat()}T06:00",
        "load_weight_lb": 45000,
        "apply_hos": False,
    }


def server_timing(header: str) -> dict[str, float]:
    return {m[1]: float(m[2]) for m in re.finditer(r"(\w+);dur=([\d.]+)", header) if m}


def run(api: str, web: str) -> list[Check]:
    checks: list[Check] = []

    def check(name: str, fn: Callable[[], tuple[bool, str]]) -> None:
        try:
            ok, detail = fn()
        except Exception as exc:  # report and keep going
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        checks.append(Check(name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}", flush=True)

    client = httpx.Client(timeout=60, headers={"User-Agent": "stormroute-smoke-test"})

    def post_plan(body: dict[str, object], **kwargs: Any) -> httpx.Response:
        r = client.post(
            f"{api}/api/plan", json=body, headers={"Accept": "application/json"}, **kwargs
        )
        if r.status_code == 429:
            wait = min(int(r.headers.get("retry-after", "60")) + 1, MAX_RETRY_WAIT_S)
            print(f"      rate limited, retrying in {wait}s", flush=True)
            time.sleep(wait)
            r = client.post(
                f"{api}/api/plan", json=body, headers={"Accept": "application/json"}, **kwargs
            )
        return r

    def health() -> tuple[bool, str]:
        start = time.monotonic()
        r = client.get(f"{api}/api/healthz", timeout=COLD_START_TIMEOUT_S)
        body = r.json()
        waited = time.monotonic() - start
        # Our middleware always sets X-Request-ID; its absence means another app answered
        # (e.g. Render gave our service a suffixed subdomain and the plain one is someone else's).
        ours = "x-request-id" in r.headers
        return r.status_code == 200 and body.get("status") == "ok" and ours, (
            f"version={body.get('version')}, ours={ours} ({waited:.1f}s, includes any cold start)"
        )

    def stream() -> tuple[bool, str]:
        start = time.monotonic()
        arrivals: list[float] = []
        with client.stream("GET", f"{api}/api/healthz/stream") as r:
            for line in r.iter_lines():
                if line:
                    arrivals.append(time.monotonic() - start)
        gaps = [b - a for a, b in itertools.pairwise(arrivals)]
        # Buffered: everything lands at once (all gaps near 0). Streaming: gaps near 0.3 s.
        streamed = len(arrivals) == 5 and sum(g > 0.15 for g in gaps) >= 3
        return streamed, "arrivals ms=" + ",".join(f"{a * 1000:.0f}" for a in arrivals)

    def cors_allowed() -> tuple[bool, str]:
        r = client.options(
            f"{api}/api/plan",
            headers={
                "Origin": web,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        got = r.headers.get("access-control-allow-origin")
        return got == web, f"allow-origin={got}"

    def cors_rejected() -> tuple[bool, str]:
        r = client.options(
            f"{api}/api/plan",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
        got = r.headers.get("access-control-allow-origin")
        return got is None, f"allow-origin={got}"

    def geocode() -> tuple[bool, str]:
        r = client.get(f"{api}/api/geocode", params={"q": "denver"})
        results = r.json().get("results", [])
        return r.status_code == 200 and len(results) > 0, f"{len(results)} results"

    def plan(label: str) -> Callable[[], tuple[bool, str]]:
        def go() -> tuple[bool, str]:
            start = time.monotonic()
            r = post_plan(demo_request(), timeout=90)
            took = time.monotonic() - start
            timing = server_timing(r.headers.get("server-timing", ""))
            size_kb = len(r.content) / 1024
            ok = r.status_code == 200 and len(r.json().get("routes", [])) >= 2
            compute = timing.get("compute")
            if compute is not None and compute > 1500:
                ok = False
            routes = len(r.json().get("routes", []))
            return ok, (
                f"{label}: HTTP {r.status_code} in {took:.1f}s, routes={routes}, "
                f"server-timing={timing}, body={size_kb:.0f} KB (compute budget 1500 ms)"
            )

        return go

    def validation() -> tuple[bool, str]:
        r = post_plan({})
        code = r.json().get("error", {}).get("code")
        return r.status_code == 400 and code == "VALIDATION", f"HTTP {r.status_code} code={code}"

    def not_found() -> tuple[bool, str]:
        r = client.get(f"{api}/nope")
        is_json = r.headers.get("content-type", "").startswith("application/json")
        content_type = r.headers.get("content-type")
        return r.status_code == 404 and is_json, f"HTTP {r.status_code} {content_type}"

    def spa(path: str) -> Callable[[], tuple[bool, str]]:
        def go() -> tuple[bool, str]:
            r = client.get(f"{web}{path}")
            ok = r.status_code == 200 and '<div id="root">' in r.text
            return ok, f"HTTP {r.status_code}"

        return go

    def web_headers() -> tuple[bool, str]:
        r = client.get(web)
        csp = r.headers.get("content-security-policy", "")
        asset = re.search(r'src="(/assets/[^"]+\.js)"', r.text)
        cache = client.get(f"{web}{asset[1]}").headers.get("cache-control", "") if asset else ""
        ok = "connect-src" in csp and api in csp and "immutable" in cache
        return ok, f"csp has api={api in csp}, asset cache-control={cache!r}"

    check("healthz", health)
    check("NDJSON streams through the proxy", stream)
    check("CORS allows the web origin", cors_allowed)
    check("CORS rejects other origins", cors_rejected)
    check("geocode", geocode)
    check("plan (cold)", plan("cold"))
    check("plan (warm, cached)", plan("warm"))
    check("validation errors are JSON 400", validation)
    check("unknown paths are JSON 404", not_found)
    check("SPA root", spa("/"))
    check("SPA deep link rewrite", spa("/some/deep/link"))
    check("web security and cache headers", web_headers)
    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="https://stormroute-api-phi1.onrender.com")
    parser.add_argument("--web", default="https://stormroute-web.onrender.com")
    args = parser.parse_args()
    checks = run(args.api.rstrip("/"), args.web.rstrip("/"))
    failed = [c for c in checks if not c.ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
