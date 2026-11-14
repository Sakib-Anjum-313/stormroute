---
name: verify-ui
description: How to run the Spotter app locally (Django API + Vite frontend, live or fixture mode) and verify UI work in a real browser before calling it done — screenshots at desktop and mobile widths, console errors, network checks, slider smoothness run, the demo trip, and the states checklist (empty, loading, partial, error, No Travel). Use this skill at the end of every frontend or full-stack task, whenever you change anything visible, when asked to "check the app", "take a screenshot", "does it work", or before committing UI changes. Type checks and unit tests alone are not proof that a UI works.
---

# Verify UI

A UI task is done only when you have seen it work in a browser and the checks below pass. Tests prove the logic. This skill proves the product.

## 1. Start the app

The preferred way uses the built-in browser preview with `.claude/launch.json`:
- `preview_start` with name `api` runs the Django dev server on :8000.
- `preview_start` with name `web` runs Vite on :5173 and proxies `/api` to :8000.

The equivalent shell commands are `make dev`, or `uv run --directory backend python manage.py runserver 8000` and `pnpm -C frontend dev`.

Pick a mode:
- **Fixture mode (default for verification):** set `PLAN_FIXTURES=1` in the `api` env. TomTom and Open-Meteo are served from `backend/trips/tests/fixtures/`, so results are deterministic and use no quota. The demo trip (Denver → Salt Lake City, 45,000 lb) always produces the same recommendation, so screenshots are comparable.
- **Live mode:** only when you are verifying integration or recording the demo. It needs `TOMTOM_API_KEY` in `backend/.env`.

## 2. Walk the checklist

Use the built-in browser tools: `read_page` and `get_page_text` for text, a screenshot for visuals, `read_console_messages` for errors, and `read_network_requests` for traffic.

1. **Empty state** at load: the form is visible, the "Try demo trip" button works, and there are no console errors or warnings (React key warnings count as failures).
2. **Submit the demo trip:** routes draw in grey before the risk colors (streamed `routes` event), the progress text advances, and then the result arrives. Three route cards are shown, one marked "Recommended".
3. **"Why this route?"** names the deciding comparator step, and its numbers match the cards.
4. **Interval toggle 10/25/50:** checkpoints change instantly. In the network panel, no request fires.
5. **Hover a route card**, then **click a checkpoint:** the map highlight syncs with the card, and the popup shows mile, ETA (local time with tz), wind/gust/rain/snow with units, the level, and the triggered rule text.
6. **Heatmap slider:** drag it from 0 to 48. The colors crossfade, the truck ghosts move along the routes, and no network requests fire. Then run `pnpm -C frontend perf:slider` and paste the summary JSON into your report. It must meet the targets in the `map-performance` skill.
7. **States:** use the fixture switches `?fixture=two_routes`, `?fixture=no_travel_all`, `?fixture=upstream_429` and `?fixture=no_route`. Each shows its banner or error card with a working retry.
8. **Responsive:** resize the window to the `mobile` preset (375×812). The bottom sheet works, the slider is reachable, and nothing scrolls horizontally. Reset to `desktop` afterwards.
9. **Keyboard and accessibility:** Tab reaches the form, toggles, slider (arrow keys move one hour) and route cards. Focus rings are visible, and the legend shows level text and not color alone.

## 3. Report

In your summary, include the screenshots taken (desktop and mobile), the console error count (must be 0), the perf summary JSON, and any checklist item you could not verify and why. Never claim that something you did not see works.
