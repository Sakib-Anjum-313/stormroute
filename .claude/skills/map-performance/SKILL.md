---
name: map-performance
description: Rules for building the MapLibre + deck.gl map, route/checkpoint layers and the 0–48 h corridor heatmap slider so it stays at 60 fps — stable layer instances, precomputed frames, updateTriggers instead of new data, Zustand selector subscriptions, binary heatmap decoding, and how to measure FPS, long tasks and network calls during scrubbing. Use this skill whenever you create or edit anything under frontend/src/features/map or frontend/src/features/heatmap, touch the time slider, add a deck.gl layer, change how plan data reaches the map, or when anyone mentions jank, lag, stutter, FPS, re-renders or map performance.
---

# Map performance

Map and heatmap smoothness is 40% of the grade. The common failure is not GPU cost: our data is tiny, with fewer than 1,000 cells and points. Jank comes from JavaScript doing avoidable work on each slider tick, such as React re-rendering the tree, deck.gl re-diffing new data arrays, or layers being rebuilt. Each rule below removes one of those costs.

## Architecture

- MapLibre GL JS draws the basemap (OpenFreeMap positron or dark). deck.gl draws on top through `MapboxOverlay` from `@deck.gl/mapbox` with `interleaved: true`, so the heatmap can sit under the basemap labels (`beforeId` set to the first symbol layer).
- One `<MapView>` component owns the overlay. Layers are built in a pure `buildLayers(state)` function that returns stable instances.
- Plan data arrives once, through the NDJSON `result` event. Decode it once in `lib/api/decodeHeatmap.ts`: base64 → `Uint8Array`/`Uint16Array`, then precompute an `RGBA Uint8Array` per frame (49 × N × 4 bytes) using the risk color scale. Nothing is decoded or allocated on slider ticks.

## Rules

1. **Never recreate data arrays per frame.** A layer's `data` prop keeps the same identity while scrubbing. Drive changes with `updateTriggers: { getFillColor: frameKey }` and an accessor that reads from the precomputed frame buffers. deck.gl reuses a layer whose `id` is unchanged, so creating a new `new Layer({...})` per render is fine as long as `id`, `data` and accessors stay stable.
2. **Crossfade, not steps.** The slider value is a float in `[0, 48]`. For `t`, lerp the RGBA of frames `floor(t)` and `ceil(t)` into one reused `Uint8ClampedArray` (`blendBuffer`), then bump `frameKey`. This is about 1,000 multiply-adds per tick, well under 1 ms.
3. **Keep the slider out of React's render path.** The slider writes `hour` to a Zustand store. Only `HeatmapLayerController` and `TruckGhosts` subscribe, using `useStore(s => s.hour)` or a transient `store.subscribe` with `overlay.setProps` — the latter for the hottest path. Route cards, the form and the panel must not re-render on a tick. Check this with React DevTools "Highlight updates".
4. **Throttle to the display, never debounce.** Coalesce slider input with `requestAnimationFrame` (at most one update per frame). A debounce makes scrubbing feel laggy.
5. **No network on interaction.** The slider, the interval toggle (10/25/50), the HOS display, hover and selection all read from memory. The only network calls are geocoding while typing and the plan submit.
6. **Memoize derived layer data by plan identity.** Decoded routes (polyline6 → `Float64Array`), checkpoint arrays per interval and per-route colored segments go in `useMemo` keyed on `plan` (and `interval`). Switching interval swaps between three precomputed arrays.
7. **Use instanced layers.** Heatmap cells use `GridCellLayer` (instanced, `cellSize` = `cell_deg` × 111 km × cos(mean lat)), or `SolidPolygonLayer` with geometry built once. Checkpoints use `ScatterplotLayer`, routes use `PathLayer` with `widthUnits: 'pixels'`, and the truck ghosts are `IconLayer` with a pre-packed atlas. No HTML markers per checkpoint.
8. **Picking stays cheap.** Use `pickable: true` only on routes and checkpoints, `autoHighlight` for hover, and the deck `onHover` writes `hoveredRouteId` to the store. Show tooltips through a single React popover positioned from the pick info, never one DOM node per checkpoint.
9. **Lazy-load the map chunk.** Import `maplibre-gl` and deck.gl with `React.lazy` so the form paints first. Load the map CSS once.
10. **Escalation path (only if N goes above about 20k cells):** upload all frames as one texture and pass `hour` as a uniform through a custom `LayerExtension`. We do not need this at about 250 cells, so don't build it preemptively.

## Measuring (do this before calling map work done)

- `pnpm perf:slider` runs Playwright script `frontend/e2e/perf/slider.perf.ts`. It loads the fixture plan, enables 4× CPU throttling via CDP, and scrubs the slider for 10 s (keyboard ArrowRight plus pointer drag). It records:
  - frame times from an injected `requestAnimationFrame` loop (`window.__frames`): **p95 ≤ 16.7 ms unthrottled, ≤ 33 ms at 4× throttle**
  - long tasks via `PerformanceObserver('longtask')`: **0 tasks > 50 ms**
  - network requests during the scrub via `page.on('request')`: **0**
  - and prints a JSON summary saved to `frontend/e2e/perf/last-run.json`.
- For a manual check: Chrome DevTools Performance, record a scrub, and confirm no "Recalculate style" storms and no React commits for components outside the map. The deck.gl `onAfterRender` stats (`deck.metrics.fps`) can be shown in a dev-only overlay with `?debug=1`.
- Payload: the heatmap section is 150 KB gzip or less for a 1,000-mile trip. The backend test `test_payload_size.py` asserts this on the fixture.
