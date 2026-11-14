# Spotter — Weather-Aware Truck Routing

This is a take-home assessment. A truck driver enters an origin, a destination, a departure time and a load weight. The app gets 3 truck routes (TomTom), samples weather (Open-Meteo) at the truck's ETA every 10/25/50 miles, classifies risk with the spec's rules, recommends a route, and shows everything on a MapLibre + deck.gl map with a 0–48 h corridor heatmap slider. The full plan is in `PLAN.md`; build milestones are in its section 12.

Grading weights: 40% logic (routes, weather, risk, recommendation), 40% UI/map/heatmap smoothness, 15% code quality, 5% docs. Correctness beats features.

## Stack
- Backend: Python 3.12 (uv), Django 5.2, DRF, drf-spectacular, httpx, timezonefinder, gunicorn (gthread). Cache is Django LocMem, or Redis if `REDIS_URL` is set.
- Frontend: Vite 8, React 19, TypeScript 7 (native `tsc`, strict), TanStack Query 5, Zustand 5, Tailwind 4 and Radix/shadcn, maplibre-gl 6, deck.gl 9 (`@deck.gl/mapbox`). Lint is oxlint + Prettier (typescript-eslint can't use TS 7's native compiler).
- Tests: pytest, hypothesis, respx, Vitest 5, React Testing Library, Playwright.
- `make api-types` runs openapi-typescript through `pnpm dlx` with TS 5.9, because TS 7 ships no JS compiler API.
- Hosting: Render. The API is a free web service and the SPA is a free static site.

## Commands (run from the repo root)
| Task | Command |
|---|---|
| Install | `make setup` |
| Dev (API :8000 + web :5173) | `make dev` |
| All tests | `make test` (`make test-backend`, `make test-frontend`) |
| Lint and format check | `make lint` (ruff, mypy, oxlint, prettier, tsc) |
| Format | `make fmt` |
| E2E | `make e2e` |
| Slider perf | `pnpm -C frontend perf:slider` |
| Regenerate API types | `make api-types` |
| Record API fixtures | `uv run --directory backend python ../scripts/record_fixtures.py` |

## Layout
```
backend/config/                 Django settings and urls
backend/trips/domain/           PURE logic: no Django, no I/O (risk, resample, eta, hos, attribution, recommend, heatmap_grid, timealign)
backend/trips/services/         I/O: tomtom.py, openmeteo.py, weather.py, planner.py, geocode.py, ratelimit.py
backend/trips/api/              DRF views, serializers, NDJSON streaming, throttles, error mapping
backend/trips/tests/            unit/ (domain), api/ (respx-mocked), fixtures/
frontend/src/features/          trip-form, routes, map, heatmap, explain
frontend/src/lib/               api (generated schema.d.ts, ndjson client, decoders), risk (colors/labels)
frontend/src/store/             Zustand stores
frontend/e2e/                   Playwright (happy path, perf/)
scripts/                        record_fixtures.py, find_demo_route.py
```

## Conventions
- Domain functions are pure, typed (`mypy --strict`) and table-tested. The services layer is the only place that does I/O. Views stay thin.
- Units in code names: `_mi`, `_mph`, `_in_hr`, `_lb`, `_s`, `_utc`. Time is UTC epoch seconds internally. Convert to local only at the edges.
- The backend is the authority on risk. The frontend never re-classifies; it only maps level to color and label.
- No secrets in the repo. `.env` is gitignored and `.env.example` is kept current.
- Streaming responses go through `trips.api.views.ndjson_response`, which gzips with a per-line sync flush. Django's GZipMiddleware buffers streams, so don't rely on it.
- Conventional commits (`feat:`, `fix:`, `test:` …). One milestone step per commit, and each commit leaves tests green.

## Project skills (read before touching the area)
- `.claude/skills/risk-rules` — any risk, load rule, aggregation or ranking code
- `.claude/skills/api-contracts` — any endpoint, serializer, fixture or external API call
- `.claude/skills/map-performance` — anything under `features/map`, `features/heatmap` or the slider
- `.claude/skills/verify-ui` — before calling any UI task done

## Definition of done
1. `make test` passes and new logic has table-driven tests.
2. `make lint` is clean (ruff, mypy, oxlint, prettier, tsc).
3. If UI changed: it was verified in the browser per `verify-ui` (screenshots, 0 console errors, perf summary if the map or slider changed).
4. `PLAN.md` and the README are updated if a decision or contract changed.
