---
name: api-contracts
description: The agreed backend↔frontend JSON contracts (POST /api/plan NDJSON stream and JSON mode, GET /api/geocode, GET /api/healthz, error shape, status codes) and the verified facts about the external APIs — TomTom Routing and Fuzzy Search, Open-Meteo Forecast, OpenFreeMap — including endpoints, parameters, units, quotas and gotchas. Use this skill before you touch any serializer, view, API client, generated TypeScript type, fixture, mock or fetch code, before you add a field to a response, and whenever you call TomTom or Open-Meteo. Also use it when debugging 429s, unit mismatches (km/h vs mph, mm vs inch, kg vs lb) or missing routes.
---

# API contracts

The contract is generated: DRF serializers → drf-spectacular OpenAPI (`backend/openapi.yaml`) → `openapi-typescript` → `frontend/src/lib/api/schema.d.ts`. Change the serializer first, run `make api-types`, then update the frontend. CI fails if the generated file drifts. Field names are `snake_case` on both sides, so there is no casing layer.

## Internal endpoints

### POST /api/plan

The request:
```json
{
  "origin":      {"label": "Denver, CO, USA", "lat": 39.7392, "lon": -104.9903},
  "destination": {"label": "Salt Lake City, UT, USA", "lat": 40.7608, "lon": -111.8910},
  "departure_local": "2026-11-15T06:00",
  "load_weight_lb": 45000,
  "apply_hos": false
}
```
- `departure_local` is a wall-clock time at the origin with no offset. The backend resolves the time zone with `timezonefinder`, converts to UTC, and echoes `origin_tz`.
- Validation (400, `VALIDATION`): departure in `[now-15 min, now+7 d]` (a past time within 15 min is clamped to now); `1 <= load_weight_lb <= 200000` (above 80,000 adds the warning `OVER_FEDERAL_GROSS_LIMIT`); origin and destination more than 1 mi apart; lat/lon in range.

Response modes:
- `Accept: application/x-ndjson` (what the UI uses): a stream of one JSON object per line.
- `Accept: application/json` (tests, curl): only the final `plan` object.

The stream events, in order:
```json
{"type":"meta","departure_utc":"2026-11-15T13:00:00Z","origin_tz":"America/Denver"}
{"type":"routes","routes":[{"id":"A","label":"Route A","source":"tomtom","summary":{...},"geometry":{"encoding":"polyline6","value":"..."}}]}
{"type":"progress","stage":"weather","done":2,"total":5}
{"type":"result","plan":{...Plan}}
```
All routing happens before the first line, so routing failures (`NO_ROUTE`, TomTom 429/5xx/timeout) and validation errors still come back as a normal HTTP error with a JSON error body, even for NDJSON requests. Error bodies are always `application/json`. On failure after the stream has started (weather), the server sends `{"type":"error","error":{...ErrorBody}}` and closes the stream. `progress` events start at `done: 0` and there is one per weather batch; a fully cached plan sends none. The client treats a stream that ends without `result` or `error` as `UPSTREAM_UNAVAILABLE`. The OpenAPI component `PlanStreamEvent` (discriminated by `type`) types every line.

The `Plan` object:
```json
{
  "departure_utc": "...", "origin_tz": "America/Denver", "generated_at": "...", "load_weight_lb": 45000, "apply_hos": false,
  "routes": [{
    "id": "A", "label": "Route A", "source": "tomtom | via_point",
    "summary": {"distance_mi": 525.1, "duration_s": 28800, "driving_s": 28800, "hos_stop_s": 0,
                "departure_utc": "...", "arrival_utc": "...", "traffic_delay_s": 0},
    "geometry": {"encoding": "polyline6", "value": "..."},
    "stops": [{"kind": "break | rest", "mile": 412.3, "lat": 41.2, "lon": -108.1, "start_utc": "...", "duration_s": 1800}],
    "intervals": {
      "10": {"checkpoints": [Checkpoint], "aggregates": Aggregates},
      "25": {"checkpoints": [Checkpoint], "aggregates": Aggregates},
      "50": {"checkpoints": [Checkpoint], "aggregates": Aggregates}
    }
  }],
  "recommendation": {"10": Recommendation, "25": Recommendation, "50": Recommendation},
  "heatmap": Heatmap,
  "warnings": [{"code": "FEWER_THAN_3_ROUTES", "message": "Only 2 distinct truck routes exist for this trip."}]
}
```
`stops` lists the HOS stops (empty when `apply_hos` is off); the `routes` event carries the same route objects without `intervals`. The geometry is Douglas–Peucker simplified at 20 m before encoding. Warning codes: `OVER_FEDERAL_GROSS_LIMIT`, `FEWER_THAN_3_ROUTES`, `WEATHER_PARTIAL` (a weather batch failed; those checkpoints are NO_DATA), `BEYOND_FORECAST_HORIZON`, `WEATHER_COARSENED` (the 550-location budget guard coarsened the heatmap and/or checkpoint lookup cells).

The `Checkpoint` object:
```json
{"mile": 250.0, "lat": 41.31, "lon": -105.59, "kind": "origin | interval | destination",
 "owned_mi": 10.0, "eta_utc": "...", "tz": "America/Denver", "status": "ok | no_data",
 "weather": {"wind_mph": 47.2, "gust_mph": 61.0, "rain_in_hr": 0.0, "snow_in_hr": 0.2, "cell": [41.3, -105.6]},
 "level": "NO_TRAVEL", "score": 4,
 "levels": {"wind": "NO_TRAVEL", "rain": "LOW", "snow": "LOW"},
 "triggers": [{"rule": "wind_band", "detail": "wind 47.2 mph in [45, 55) → Severe"},
              {"rule": "load_45_54_over_30k", "detail": "47.2 mph with 45,000 lb > 30,000 lb → No Travel"}]}
```
The `Aggregates` object: `{"miles_by_level": {"LOW":…, "MODERATE":…, "HIGH":…, "SEVERE":…, "NO_TRAVEL":…, "NO_DATA":…}, "avg_risk": 0.84, "max_level": "SEVERE", "checkpoint_count": 54}`

The `Recommendation` object:
```json
{"route_id": "B", "ranking": ["B", "A", "C"], "all_no_travel": false,
 "steps": ["no_weather_data", "no_travel_mi", "severe_mi", "high_mi", "avg_risk", "duration_min"],
 "keys": {"A": [0, 0.0, 18.5, 40.0, 1.12, 482], "B": [0, 0.0, 0.0, 22.5, 0.91, 515], "C": [0, 0.0, 7.0, 10.0, 0.70, 530]},
 "decided_by": {"A": "severe_mi", "C": "severe_mi"}, "decisive_step": "severe_mi"}
```
`keys[r][0]` (`no_weather_data`) is 1 for a route without any weather data, else 0, and that route's `keys[r][4]` (avg risk) is `null`. `decided_by` and `decisive_step` take a step name or `"route_order"` (a full tie broken by provider order). `decisive_step` is the step that separated the winner from the runner-up (`null` with one route).

Display rounding: wind and gusts to 0.1 mph, rain and snow to 0.001 in/hr. A displayed value is nudged one unit toward the raw value if rounding would move it into another band (34.96 mph shows as 34.9, never 35.0), so the number always agrees with `level`. Classification always uses the raw value.
The `Heatmap` object is columnar and binary for size and zero-parse decoding:
```json
{"base_time_utc": "2026-11-15T13:00:00Z", "hours": 49, "cell_deg": 0.2, "count": 240,
 "lat": [..240 floats..], "lon": [..240 floats..],
 "levels_b64": "<Uint8 count*hours, frame-major: idx = h*count + i; 255 = no data>",
 "wind_mph_x10_b64": "<Uint16 LE>", "rain_in_hr_x1000_b64": "<Uint16 LE>", "snow_in_hr_x100_b64": "<Uint16 LE>"}
```
The quantized arrays use `65535` for no data.

### GET /api/geocode?q=denv&limit=5
Returns `{"results": [{"label": "Denver, CO, USA", "lat": 39.74, "lon": -104.99, "kind": "Geo"}]}`. Zero matches return 200 with `results: []`, never 404. It needs at least 3 characters (otherwise 400) and is cached for 24 h. `/api/plan` always takes explicit coordinates, so the plan endpoint never geocodes.

### GET /api/healthz
Returns `{"status": "ok", "version": "<git sha>"}`. There are no upstream calls, so keep-warm pings are free.

### Headers and fixture mode
- Every response has `X-Request-ID` (echoed when the request sends a well-formed one). INTERNAL errors put it in `details.request_id`.
- JSON-mode plans send `Server-Timing: tomtom;dur=…, openmeteo;dur=…, compute;dur=…`. Errors with `retry_after_s` also send `Retry-After`.
- `PLAN_FIXTURES=1` serves recorded data with no network. `X-Fixture: default | two_routes | no_travel_all | upstream_429 | no_route` picks a scenario (unknown values are 400). The header is ignored in live mode.

### Error shape (all endpoints)
```json
{"error": {"code": "NO_ROUTE", "message": "No truck route between these points.", "details": {}, "retry_after_s": null}}
```
| code | HTTP | when |
|---|---|---|
| `VALIDATION` | 400 | bad input (`details` holds field errors) |
| `NO_ROUTE` | 422 | TomTom `NO_ROUTE_FOUND` / `MAP_MATCHING_FAILURE` |
| `RATE_LIMITED` | 429 | our own DRF throttle (10 plans/min/IP) |
| `UPSTREAM_RATE_LIMITED` | 503 | TomTom or Open-Meteo returned 429 after retries; `retry_after_s` is set |
| `UPSTREAM_UNAVAILABLE` | 502 | upstream 5xx or bad payload |
| `UPSTREAM_TIMEOUT` | 504 | upstream timeout (TomTom 10 s, Open-Meteo 8 s per batch) |
| `INTERNAL` | 500 | bug; logged with request id |

TomTom `BAD_INPUT` maps to `VALIDATION`, `COMPUTE_TIME_LIMIT_EXCEEDED` to `UPSTREAM_TIMEOUT`, and 401/403 (bad key) to `UPSTREAM_UNAVAILABLE`. 429 and 5xx are retried twice with jittered backoff (1 s, 3 s); timeouts are not retried (the plan has a 25 s total budget).

## External APIs (verified 2026-11-14; re-verify if behavior surprises you)

### TomTom Routing — Calculate Route
Docs: https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
- `GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lon}:{lat,lon}[:{lat,lon}...]/json?key=…`
- Parameters we use: `travelMode=truck`, `vehicleWeight=<kg int>` (lb × 0.45359237, rounded), `vehicleCommercial=true`, `maxAlternatives=4` (allowed 0–5), `alternativeType=anyRoute`, `routeType=fastest`, `traffic=true`, `departAt=<RFC3339 with offset>` (cannot combine with `arriveAt`), `computeTravelTimeFor=all`, `extendedRouteRepresentation=distance&extendedRouteRepresentation=travelTime`, `routeRepresentation=polyline`.
- `routes[].progress[]` gives `{pointIndex, distanceInMeters, travelTimeInSeconds}`, cumulative from the route start. The first and last points always have entries. Interpolate linearly by haversine distance between entries (the docs recommend this).
  - **Spike fact:** entries are sparse, not one per point. A route has 63–257 entries, spaced a median of 4.5–12.8 km apart with gaps up to 130 km (on long interstate stretches). Interpolation assumes constant speed within a gap, and README "known limitations" says so.
- `routes[].summary`: `lengthInMeters`, `travelTimeInSeconds`, `trafficDelayInSeconds`, `trafficLengthInMeters`, `departureTime`, `arrivalTime`, and with `computeTravelTimeFor=all` also `noTrafficTravelTimeInSeconds`, `historicTrafficTravelTimeInSeconds`, `liveTrafficIncidentsTravelTimeInSeconds`.
- `routes[].legs[].points[]`: `{latitude, longitude}`. There is one leg per OD pair (more with via points). **Spike fact:** the polyline is dense, with 7k–19k points per route (about 1 point per 115 m). Simplify with Douglas–Peucker before sending it to the client. The final progress `distanceInMeters` equals `summary.lengthInMeters`.
- `routes[].sections[]` holds only `TRAVEL_MODE` unless more `sectionType`s are requested.
- Errors come in `detailedError.code`: `MAP_MATCHING_FAILURE`, `NO_ROUTE_FOUND`, `BAD_INPUT`, `COMPUTE_TIME_LIMIT_EXCEEDED`. Match on the code, never on the message text.
- Up to 150 waypoints. A via-point fallback uses `origin:via:dest` with `maxAlternatives=0`.
- Quota: Freemium gives 2,500 non-tile requests/day, no credit card, commercial use OK (https://developer.tomtom.com/store/maps-api). Routing and search share the quota.
- **Verified in the M0 spike (2026-11-14, 45,000 lb truck, `maxAlternatives=4`):** truck mode honors alternatives and returns the primary plus up to 4 (4–5 routes for all four test trips: Denver→SLC, Chicago→Denver, Seattle→Boise, Dallas→Albuquerque). Every trip had at least 3 routes sharing under 50% of their length. One Chicago→Denver alternative shared 81% with the primary, so the "most distinct" selection matters. Responses carry **no rate-limit or QPS headers**, so back off on 429 only.
- Still UNVERIFIED: whether TomTom's terms allow showing route results on a non-TomTom basemap (the terms page is JS-rendered). Fallback: TomTom's MapLibre vector style with the same key.

### TomTom Fuzzy Search (geocoding and typeahead)
Docs: https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search
- `GET https://api.tomtom.com/search/2/search/{query}.json?key=…&typeahead=true&limit=5&countrySet=US,CA,MX&idxSet=Geo,PAD,Addr,Str`
- Use `results[].position.{lat,lon}` and `results[].address.freeformAddress`. The separate Autocomplete API returns no coordinates, so do not use it.

### Open-Meteo Forecast
Docs: https://open-meteo.com/en/docs · Limits: https://open-meteo.com/en/pricing
- `GET` or `POST https://api.open-meteo.com/v1/forecast` (POST form body avoids 414 errors; GET with 1,000 coordinates returned 414).
- `latitude=a,b,…&longitude=x,y,…` returns a JSON list in the same order.
- `hourly=wind_speed_10m,wind_gusts_10m,rain,showers,snowfall&wind_speed_unit=mph&precipitation_unit=inch&timeformat=unixtime&timezone=GMT&start_hour=YYYY-MM-DDTHH:MM&end_hour=…`
- Semantics: `wind_speed_10m` is instantaneous; `wind_gusts_10m` is the preceding-hour max; `rain`, `showers` and `snowfall` are preceding-hour sums. With `precipitation_unit=inch`, `snowfall` is in **inches** (verified: `hourly_units.snowfall == "inch"`). Rain for the risk table = `rain + showers`.
- Free tier: 600 calls/min, 5,000/hour, 10,000/day, non-commercial only. **Each location in a multi-location request counts as a call** (verified twice: 600 locations in about a minute hit 429, and a 72-location POST returned `x-ratelimit-cost: 72.0`). Headers: `x-ratelimit-cost`, `x-ratelimit-limit: 600`, `x-ratelimit-remaining`, `x-ratelimit-reset` (epoch s), `x-ratelimit-window: 60`. Read `x-ratelimit-remaining` to feed the token bucket. More than 10 variables, or more than 2 weeks of range, also counts extra.
- `start_hour`/`end_hour` are **inclusive**: a 72 h span returns 73 hourly values (verified).
- Our budget: batches of 100 locations, a client-side token bucket of 500 locations/min, at most about 550 unique locations per plan, 60 min cache per `(lat2, lon2, start_hour, end_hour)`.
- Attribution required: "Weather data by Open-Meteo.com" (CC BY 4.0).

### OpenFreeMap (basemap)
https://openfreemap.org — free, no key, no request limits, commercial OK. Attribution (OpenFreeMap © OpenMapTiles, data © OpenStreetMap) is added by MapLibre. Style: `https://tiles.openfreemap.org/styles/positron` (light) and `/dark`.

## Secrets
`TOMTOM_API_KEY` exists only in the backend environment. The frontend never calls TomTom or Open-Meteo directly. Fixtures in `backend/trips/tests/fixtures/` are scrubbed of `key=` by the recording script.
