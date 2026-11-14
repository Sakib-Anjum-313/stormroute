# Planning Prompt — Spotter Full Stack Assessment (Weather-Aware Truck Routing)

> Paste everything below the line into a fresh Claude Code session opened in this project folder.
> Use plan mode (Shift+Tab until "plan mode") so nothing is built until the plan is approved.

---

You are a staff-level full-stack engineer and technical lead. Your job in this session is to produce the **best possible implementation plan** for a take-home assessment. Only ~4% of candidates advance, so the plan must aim for a top-tier submission: provably correct logic, a buttery-smooth map, clean code, and a clear demo. **Do not write application code in this session.** Output a plan I will approve, then we build it together step by step.

## 1. The assessment (verbatim requirements — treat as the spec)

Build a **React + Django** web app that helps a truck driver choose the safest route based on **weather, load weight, and travel time**.

User enters:
- Origin & destination
- Departure date/time
- Load weight

The app should:
- Generate **3 route options** using a routing API.
- Sample weather every **10 / 25 / 50 miles**, using the truck's **estimated arrival time** at each checkpoint.
- Calculate weather risk using the provided risk/load rules.
- Recommend the best route, balancing **weather risk and travel time**.
- Show all routes, checkpoints, risk levels, ETAs, and route summaries on a map.
- Show a **weather heatmap along the trip corridor** with a **0–48 hour forecast slider**.

Third-party APIs for routing, geocoding and weather are allowed. No need to build a routing engine.

**Risk thresholds (per checkpoint):**

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind | <25 mph | 25–34 | 35–44 | 45–54 | ≥55 mph |
| Rain | <0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | >1.00 |
| Snow | <0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | >3.0 |

**Load rules:**
- ≥55 mph → No Travel for any load
- 45–54 mph + >30,000 lb → No Travel
- 35–44 mph + >40,000 lb → Severe

**Route recommendation — prefer, in order:**
1. Fewest Severe miles
2. Fewest High miles
3. Lowest average risk
4. Shortest travel time

**Deliverables:** GitHub repository, hosted application, 5–10 min Loom walkthrough.

**Evaluation weights:**
- 40% Routes, weather, risk & recommendation logic
- 40% UI, map & heatmap smoothness and performance
- 15% Code quality
- 5% Documentation & walkthrough

"Prioritize correctness and clarity over extra features."

Every decision in the plan must trace back to one of these weights. The two 40% buckets are where the plan should spend most of its depth.

## 2. Set up your tooling first (before planning)

Before you write the plan, set up the environment so this session and the build sessions after it get the best results. Report what you did in a short "Tooling setup" section at the top of the plan.

1. **Check what's available.** List the skills, plugins and MCP servers this session has. Search the plugin/skill catalog for anything useful for: frontend/UI design quality, React + TypeScript, Django/Python, testing (pytest, Vitest, Playwright), map/WebGL performance, code review, and up-to-date library docs. Suggest installing the ones that clearly help, and tell me why in one line each. Don't install things that add noise.
2. **Up-to-date docs.** If a docs MCP (e.g. Context7) or web search is available, use it. **Verify every third-party API claim against current official docs** (endpoints, parameters, limits, free-tier quotas, units, whether alternatives/truck profiles are supported). Do not rely on memory for API details — cite the doc URL in the plan.
3. **Create project skills** in `.claude/skills/` (use the skill-creator skill if available) so later build sessions stay consistent. At minimum:
   - `risk-rules` — the exact threshold table, load rules, boundary conventions we agree on, unit conversions, and the recommendation ordering, plus the canonical test cases. Any code touching risk must follow this skill.
   - `api-contracts` — the agreed backend↔frontend JSON contracts and the external API facts you verified (endpoints, units, limits).
   - `map-performance` — rules for the map/heatmap layer (no re-creating layers per frame, precomputed frames, memoization, how to measure FPS).
   - `verify-ui` — how to run the app and check it in the browser (screenshots, slider smoothness check, console errors) before calling any UI task done.
4. **Create `CLAUDE.md`** at the repo root: project summary, stack, commands (dev, test, lint, build), folder layout, coding conventions, "definition of done" (tests pass, types pass, lint clean, UI verified in browser), and a pointer to the skills above. Keep it short.
5. Propose a **`.claude/settings.json`** allowlist for the routine commands (test, lint, dev server) so the build doesn't stall on prompts.

## 3. How to handle engineering decisions

I make the engineering decisions with you. **Do not silently pick.** For every meaningful decision:

- Ask me using the question tool (AskUserQuestion), **up to 4 questions per round**, grouped by topic.
- Give **2–4 options**, each with a **one-line brief** covering the trade-off (correctness, performance, effort, risk, cost, hosting).
- Put **your recommended option first** and mark it **"(Recommended)"**, with the reason tied to the evaluation weights.
- If a decision is a convention with an obvious answer, don't ask — decide, and list it under "Assumptions" in the plan.
- After my answers, record each decision in an **ADR-style table** in the plan (Decision / Choice / Why / Rejected alternatives).

Decisions I expect you to raise (add any others you find):

**Spec interpretation (highest stakes — the graders will check these):**
- What "every 10 / 25 / 50 miles" means: user-selectable interval, auto by trip length, or all three computed.
- Boundary handling where the table overlaps or is integer-only (e.g. rain 0.25 sits in both Moderate and High; wind 34.6 mph; snow 1.0). Propose one consistent convention and show it.
- Combining conditions: overall checkpoint level = max across wind/rain/snow after load rules? Sustained wind vs gusts — which one, or both?
- How Severe/High **miles** are attributed from point checkpoints (segment takes the worse endpoint, half-interval ownership, forward-fill). Origin and destination as checkpoints?
- How "No Travel" ranks in the recommendation (it is not in the 4-step list — propose treating it as strictly worse than Severe, and say how the UI flags it).
- Numeric scale for "average risk" (e.g. Low=0 … No Travel=4) and whether it is distance-weighted.
- Matching weather time to ETA: nearest hour vs linear interpolation between hourly values; timezone handling of the departure time.
- Trips or departures beyond the forecast horizon, and departures in the past.
- Whether ETAs should model driver hours-of-service rest stops (Spotter is a trucking company — long trips without breaks give wrong ETAs) or use raw routing duration. Weigh against "correctness over extra features".

**Stack & APIs:**
- Routing API that reliably returns **3 distinct routes**, ideally truck-aware (e.g. HERE, OpenRouteService HGV, Mapbox, Google, OSRM). What happens when the API returns fewer than 3 (via-point alternatives, etc.)?
- Geocoding/autocomplete provider.
- Weather provider and its units (e.g. Open-Meteo: free, no key, hourly, batched multi-location — verify snowfall units and conversion to in/hr).
- Map library: MapLibre GL / deck.gl (WebGL) vs Leaflet vs Google Maps — judged on heatmap smoothness.
- Heatmap approach: corridor grid density and spacing, all 49 hourly frames precomputed in one backend response vs fetched per slider step, GPU heatmap layer vs raster tiles, interpolation between hours.
- Backend shape: Django + DRF, sync vs async outbound calls (concurrency for many weather points), caching layer (in-memory vs Redis), rate-limit protection, API keys kept server-side.
- Frontend shape: Vite + React + TypeScript, server-state library (TanStack Query), local state (Zustand/Context), styling (Tailwind / component library).
- Hosting: one service serving the built frontend vs split frontend/backend; provider choice (Render, Railway, Fly.io, Vercel + backend host) and cold-start mitigation so the reviewer never sees a dead or sleeping app.
- Testing depth and CI (GitHub Actions running backend + frontend tests and lint).

## 4. What the plan must contain

Produce the plan as a single markdown document (`PLAN.md`) with these sections:

1. **Tooling setup** — what you installed/created and why.
2. **Spec interpretation & assumptions** — every ambiguity, the chosen interpretation, and why. This section should read like something I can show the reviewer.
3. **Decision log (ADR table)** — filled from my answers.
4. **Architecture** — diagram (Mermaid) of frontend, Django API, external APIs, cache; request flow for "plan a trip" from form submit to map render.
5. **Domain model & algorithms**, precise enough to implement without guessing:
   - Polyline resampling at fixed mile intervals along the route geometry (haversine/geodesic, cumulative distance).
   - ETA at each checkpoint (from routing leg durations/annotations, not straight-line proportion, if the API allows; otherwise state the approximation).
   - Weather lookup at (lat, lon, ETA), batching and dedup of nearby points.
   - Risk classification as **pure, side-effect-free functions** (no I/O) with the load rules applied.
   - Mile attribution, per-route aggregates, and the lexicographic recommendation comparator, including tie-breaks.
   - Heatmap corridor: how cells are generated around the routes, values per cell per hour, payload size estimate.
6. **API contract** — request/response JSON for each endpoint with example payloads, error shapes, and status codes.
7. **Frontend UX** — layout (form, route cards, map, slider, legend), states (empty, loading with progress, partial failure, error, No-Travel warning), a **"Why this route?"** explanation panel that shows the comparator step that decided the recommendation, checkpoint popups (miles, ETA, wind/rain/snow values, level, which rule triggered), route hover/select sync between cards and map, accessible color scale, responsive layout.
8. **Performance plan** with measurable targets: e.g. slider scrubbing at ~60 fps with no network calls, time-to-first-route, backend response time with cache cold/warm, payload sizes. Name the techniques (precomputed frames, memoized layers, updating layer data instead of recreating, debouncing, Web Worker if needed) and how each target will be measured.
9. **Testing strategy** — unit tests for every threshold boundary and every load rule (table-driven), comparator tests for each tie-break level, resampling/ETA tests, API tests with mocked external services (recorded fixtures), a few frontend component tests, and one Playwright end-to-end happy path. Mark which tests are must-have.
10. **Error handling & resilience** — geocode not found/ambiguous, no route, fewer than 3 routes, weather API down or rate-limited, timeouts, partial data; what the user sees in each case.
11. **Code quality** — repo structure (backend apps, services layer, frontend feature folders), typing (mypy/pyright, strict TS), linting/formatting (ruff, eslint, prettier), pre-commit, env var handling, no secrets in repo.
12. **Build milestones** — ordered phases, each small enough for one focused build session, each ending in a working, tested, committed state. Front-load the riskiest parts (3 routes from the chosen API, weather/ETA correctness, heatmap smoothness spike). Include an early end-to-end vertical slice. Give a rough time estimate per phase.
13. **Deployment plan** — step by step, env vars, health check, seeded demo trip, keep-warm strategy.
14. **README outline** — setup, architecture, spec interpretations, risk rules with examples, trade-offs, known limitations, what I'd do with more time.
15. **Loom script (5–10 min)** — minute-by-minute: problem, live demo of a trip where weather actually changes the recommendation, heatmap slider, risk logic walkthrough in code + tests, architecture and trade-offs, close.
16. **Rubric checklist** — every requirement and every evaluation bucket mapped to the plan section/milestone that covers it, so nothing is missed.
17. **Risks & mitigations** — top risks (API limits, 3-route availability, cold starts, heatmap performance on long trips) with fallback for each.

## 5. Quality bar and rules

- **Correctness first, then smoothness, then polish.** No feature that isn't in the spec unless it directly raises a rubric score; if you propose one, mark it optional and say which bucket it serves.
- Every number in the risk logic comes from the spec table or from a decision I approved — no invented thresholds.
- Prefer free APIs with no credit card, or clearly note cost/limits.
- Find a demo route where the 3 routes really differ in weather risk (or explain how to pick one on recording day), so the recommendation logic is visibly exercised.
- Be concrete: name libraries, endpoints, file paths, function names. No hand-waving like "handle errors appropriately".
- When unsure about any external fact, verify it with docs/search and cite the source, or flag it as unverified.

## 6. Process for this session

1. Do the tooling setup (section 2) and report it.
2. Read the spec carefully and research the APIs (section 3 stack questions) against current docs.
3. Ask me the decision questions in rounds (spec interpretation first, then stack, then hosting/testing). Wait for my answers each round.
4. Write `PLAN.md` with all sections in section 4, plus the skills and `CLAUDE.md` from section 2.
5. End with a short summary: the top 5 things that will make this submission stand out, and the first milestone to build.
