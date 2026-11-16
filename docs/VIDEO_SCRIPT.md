# Loom walkthrough script (about 8 minutes)

Narration is about 1,150 words, which runs 8 minutes at a calm 145 words per minute. Each
section lists what to show (**SCREEN**) and what to say (**SAY**). Words in `[brackets]` are
read off the screen on the day, because live weather changes the numbers.

---

## Before you record

### The day before or that morning
- [ ] **Check the weather quota.** Open-Meteo's free tier gives 10,000 locations per day per IP,
      and Render's outbound IP is shared. If the app shows "Service busy" with a long retry, the
      daily quota is spent; it resets at **00:00 UTC**. Record after the reset, not right before.
- [ ] Optional: find a trip with interesting weather today (uses about 1–2k weather locations,
      so run it once):
      `uv run --directory backend python ../scripts/find_demo_route.py`
      If a better trip shows up, use it in place of the demo button and adjust the `[brackets]`.
- [ ] `curl https://stormroute-api-phi1.onrender.com/api/healthz` returns `status: ok`.

### Ten minutes before
- [ ] Open https://stormroute-web.onrender.com and run **Try demo trip** once. This warms the
      routing and weather caches, so on camera the plan streams in fast. Note which route is
      recommended and why, and fill in the `[brackets]` below.
- [ ] Then try the demo at **25,000 lb** once, and note whether the recommendation changes.
      This decides which version of Scene 4 you read.
- [ ] Browser: one window, zoom 100–110%, bookmarks bar hidden, notifications off.
- [ ] DevTools docked at the bottom, **Network** tab, filter `Fetch/XHR`, cleared. Close it again.
- [ ] Editor open with these tabs in order:
      1. `backend/trips/api/views.py`
      2. `backend/trips/services/planner.py` (scroll to `def stream`)
      3. `backend/trips/domain/risk.py` (scroll to `def assess`)
      4. `backend/trips/domain/recommend.py` (scroll to `def route_key`)
      5. `backend/trips/tests/unit/test_load_rules.py`
      6. `frontend/src/features/map/scene.ts`
      7. `frontend/e2e/perf/last-run.json`
- [ ] Terminal open in the repo root, font large. Run `make test-backend` now and leave the
      `407 passed` line on screen for Scene 6.

### Fallback if the live API is rate limited while recording
Run the app locally on recorded data (no keys, no quota, same demo trip every time):

```bash
make setup
```

Set `PLAN_FIXTURES=1` in `backend/.env`, then:

```bash
make dev
```

Record against http://localhost:5173 and say once in Scene 1: "I'm running locally on recorded
API responses so the demo is reproducible; the hosted version is at the link below."

---

## Scene 1 — Hook (0:00–0:30)

**SCREEN:** The live app, empty state, map of the US. Cursor still.

**SAY:**
> Hi, I'm Sakib. This is Spotter, a weather-aware truck routing app I built for the full-stack
> assessment. A driver enters where they're going, when they leave, and how heavy the load is.
> The app finds three truck routes, checks the weather at the time the truck will actually be at
> each point, scores the risk with the given rules, and recommends the safest route. It's React
> and Django, and it's live on Render.

---

## Scene 2 — The problem and the rules (0:30–1:15)

**SCREEN:** Click **Thresholds & symbols** in the legend to expand the rule table. Point at the
wind row, then the load rules.

**SAY:**
> The core idea is that weather is about *when*, not just *where*. A storm at mile 300 only
> matters if the truck is at mile 300 while it's happening. So every checkpoint is matched to the
> truck's estimated arrival time.
>
> Risk follows the spec's table: wind, rain and snow each get a level from Low to No Travel, and
> the checkpoint takes the worst of the three. Load weight matters for wind. At 45 to 54 miles
> an hour, anything over 30,000 pounds becomes No Travel. At 35 to 44, over 40,000 pounds
> becomes Severe.
>
> Where the spec was ambiguous, I made one rule and applied it everywhere: a value exactly on a
> boundary goes to the worse band, and I never round before classifying. Every one of those
> decisions is written down in PLAN.md.

---

## Scene 3 — Live demo: planning a trip (1:15–2:45)

**SCREEN:** Click **Try demo trip**. Let the stream play out without talking over the first
second. Point at the progress list (Routing ✓, Weather, Scoring), then the grey routes, then the
colored routes and cards.

**SAY:**
> I'll use the demo trip: Denver to Salt Lake City with 45,000 pounds, leaving at 6 a.m. Denver
> time. That crosses Wyoming and the Rockies, which get a lot of wind.
>
> Notice the routes show up first, in grey. The API streams the plan as newline-delimited JSON,
> so the driver sees the routes in about a second, then the weather progress, then the scoring.
> Nothing here is a fake spinner; each step is a real event from the server.
>
> Now we have three routes. Each card shows distance, drive time, arrival time, and a bar of
> miles at each risk level. Route `[B]` is recommended.

**SCREEN:** Hover each card in turn; the matching path highlights on the map. Then click a
checkpoint dot on the riskiest stretch to open the popup.

**SAY:**
> Hovering a card highlights the route on the map, and the other way around. Each dot is a
> checkpoint. If I click one here `[in Wyoming]`, I get the arrival time, the wind, gusts, rain
> and snow at that moment, the level for each, and the exact rule that fired, in plain words,
> like `[wind 38 miles an hour with 45,000 pounds over 40,000, so Severe]`.

---

## Scene 4 — Why this route, and the load rule (2:45–3:45)

**SCREEN:** Scroll to **Why this route**. Point at the highlighted cell and read the sentence.

**SAY:**
> The "Why this route" panel shows the comparator. The spec says: fewest Severe miles, then
> fewest High miles, then lowest average risk, then shortest time. I added two safety steps in
> front: a route with no weather data at all can never win, and No Travel miles count before
> Severe. The highlighted cell is where the decision was made. Here, `[B wins on Severe miles:
> zero versus 18 on A]`.

**SCREEN:** Change Load weight to **25000**, click **Plan route**. Read the new result.

**SAY — if the recommendation changes:**
> Now watch what happens if I drop the load to 25,000 pounds. The same wind is no longer Severe
> for a lighter truck, so the risk evens out and the faster route `[A]` wins. Same weather, same
> roads, a different answer, purely because of the load rules.

**SAY — if it does not change:**
> If I drop the load to 25,000 pounds, the colors on the windy stretch step down, because the
> load rules no longer escalate that wind. Today `[B]` still wins, because `[it also avoids the
> rain / snow on A]`. The popup now shows the wind without the load trigger.

**SCREEN:** Click **10**, **25**, **50** in Checkpoint interval.

**SAY:**
> The spec says sample every 10, 25 or 50 miles. I compute all three in one request, so this
> toggle is instant, and each has its own recommendation. If all three agree, you can trust the
> answer isn't an artifact of where the samples happened to land.

---

## Scene 5 — The 48-hour heatmap and performance (3:45–4:45)

**SCREEN:** Open DevTools Network tab (cleared). Press **play** on the slider, then drag it back
and forth quickly. Point at the truck ghosts. Show the Network panel stays empty.

**SAY:**
> At the bottom is the corridor heatmap with a 0-to-48-hour slider from departure. Each cell is
> colored with the same rules and the same load weight as the checkpoints, so the two can never
> disagree. These small trucks are each route's position at the slider time, so you can watch
> each truck move through the weather.
>
> Smoothness is 40% of the grade, so I designed for it. All 49 hourly frames arrive with the
> plan, decoded once into typed arrays. When I scrub, there are zero network requests, as you
> can see, and zero React re-renders. The map listens to the store directly and blends two
> precomputed frames into one reused buffer, once per animation frame.

**SCREEN:** Switch to editor tab `frontend/e2e/perf/last-run.json`.

**SAY:**
> I measured it with a Playwright script that scrubs the production build for ten seconds: p95
> frame time 16.7 milliseconds, which is a steady 60 frames per second, no dropped frames, no
> long tasks, and the same at four-times CPU throttling.

---

## Scene 6 — Code: one request, end to end (4:45–6:45)

**SCREEN:** Editor, `backend/trips/api/views.py`, `PlanView.post`.

**SAY:**
> Let's follow one request through the code. The backend has three layers. `domain` is pure
> logic with no Django and no network. `services` does all the I/O. And `api` is thin HTTP glue.
> The view validates the request, converts the departure to UTC using the origin's time zone,
> and returns a stream from the planner.

**SCREEN:** `planner.py`, `def stream`. Point at the `yield` lines in order.

**SAY:**
> The planner is the orchestrator. First, TomTom truck routing with the load weight and up to
> four alternatives. I remove near-duplicates, and if fewer than three distinct routes remain, I
> try detours through via-points; I never fake a third route. Then it yields the routes, which
> is why they appear early.
>
> Next, checkpoints every 10, 25 and 50 miles. TomTom gives cumulative travel time along the
> route, so each checkpoint gets a real ETA, not a straight-line guess.
>
> Then weather. Open-Meteo counts every location in a request against its quota, which I
> confirmed by hitting the limit. So the points snap to a 0.1-degree grid, get deduplicated
> across all routes and intervals, cached for an hour, and sent in batches behind a rate
> limiter. Wind is interpolated between hours; rain and snow use the hour bucket that contains
> the ETA, which matches how Open-Meteo defines them.

**SCREEN:** `risk.py`, `def assess`. Point at `band_level`, then the two load-rule branches.

**SAY:**
> Here's the risk function. It's one pure function used for checkpoints and the heatmap. Each
> variable is classified by its bands, the load rules escalate the wind level, and the result is
> the worst of the three, plus a list of triggers that becomes the text in the popup.

**SCREEN:** `recommend.py`, `def route_key`.

**SAY:**
> The recommendation is a single sort key: no-data, No Travel miles, Severe miles, High miles,
> average risk, travel time, then route order as a final tie-break. The first step where a route
> differs from the winner is recorded, and that drives the Why panel. Small rounding only absorbs
> floating-point noise.

**SCREEN:** `test_load_rules.py`, scroll through the parametrize table. Switch to the terminal,
where you ran `make test-backend` before recording (it takes about 40 seconds), and show the
final line: `407 passed`.

**SAY:**
> Because the logic is pure, it's tested exhaustively. Every boundary is tested just below, on,
> and just above. Load rules are tested at 30,000 and 30,001 pounds, 40,000 and 40,001, against
> winds around each threshold. Property tests check that checkpoint miles always add up to the
> route length. There are about 400 backend tests, and the API tests replay recorded TomTom and
> Open-Meteo responses, so they're deterministic.

---

## Scene 7 — Engineering decisions (6:45–7:30)

**SCREEN:** `frontend/src/features/map/scene.ts` briefly, then the GitHub repo page showing a
green CI check.

**SAY:**
> A few decisions worth calling out. On the frontend, React renders the form and the cards, but
> the map is driven by a store subscription outside React, so slider ticks never touch the
> component tree. The backend is the only authority on risk; the frontend only maps a level to a
> color and a label. API types are generated from the OpenAPI schema, and CI fails if they drift.
>
> CI runs ruff, mypy in strict mode, oxlint, TypeScript, all the tests and Playwright end-to-end,
> and Render only deploys after CI passes. A pinger keeps the free API warm, and if it does
> sleep, the app tells you it's waking up instead of hanging.

---

## Scene 8 — Limits and close (7:30–8:00)

**SCREEN:** Back to the app with the recommended route selected and the heatmap at a
mid-trip hour.

**SAY:**
> Some honest limits. I score sustained wind, not gusts, because the spec gives no gust
> thresholds. The free weather tier is shared per IP, so on a busy day it can be rate limited,
> and the app says so clearly. With more time I'd add forecast uncertainty, road-weather alerts,
> and a "leave three hours later" suggestion.
>
> The README, the full walkthrough and every design decision are in the repo. Thanks for
> watching.

---

## Timing cheat sheet

| Time | Scene | Must show |
|---|---|---|
| 0:00 | Hook | Empty app |
| 0:30 | Rules | Legend thresholds |
| 1:15 | Demo | Grey routes, then colors; card hover; checkpoint popup |
| 2:45 | Why + load | Why table, weight 45k → 25k, 10/25/50 toggle |
| 3:45 | Heatmap | Play, scrub, ghosts, empty Network tab, perf JSON |
| 4:45 | Code | views → planner → risk → recommend → tests run |
| 6:45 | Decisions | scene.ts, green CI |
| 7:30 | Close | Final map shot |

If you run long, cut in this order: the `scene.ts` shot in Scene 7, the 10/25/50 toggle
explanation (keep the clicks), then the test run (just show the test file).
