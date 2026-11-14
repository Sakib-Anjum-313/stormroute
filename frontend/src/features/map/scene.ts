/**
 * Connects the store to the deck.gl overlay without React. The map never re-renders: store
 * changes are coalesced into at most one `overlay.setProps` per animation frame, and a slider tick
 * only blends the heatmap frames into a reused buffer and bumps `frameKey` (map-performance
 * skill, rules 1-4).
 */
import type { MapboxOverlay } from '@deck.gl/mapbox'
import type { Map as MaplibreMap } from 'maplibre-gl'

import { blendFrames } from '../../lib/api/decodeHeatmap'
import { pathBounds } from '../../lib/geo/geo'
import type { DecodedPlan, MapRoute } from '../../lib/plan/decodePlan'
import { selectRoute, setHoveredRoute, usePlanStore, type PlanState } from '../../store/planStore'
import { buildHeatCells, buildLayers, type HeatCell } from './buildLayers'

/** Read by the perf script and handy in DevTools; holds no state the app depends on. */
export interface SceneDebug {
  frameKey: number
  renders: number
  layers: string[]
  map: MaplibreMap
}

declare global {
  interface Window {
    spotterScene?: SceneDebug
  }
}

export function firstSymbolLayerId(map: MaplibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
}

export function createScene(map: MaplibreMap, overlay: MapboxOverlay): () => void {
  let beforeId: string | undefined
  let ready = false
  let frame = 0
  let heatDirty = true
  let frameKey = 0
  let heatPlan: DecodedPlan | null = null
  let heatCells: HeatCell[] = []
  let heatColors = new Uint8ClampedArray(0)
  let fittedCount = 0
  const debug: SceneDebug = { frameKey: 0, renders: 0, layers: [], map }
  window.spotterScene = debug

  function syncHeatmap(state: PlanState) {
    if (state.plan !== heatPlan) {
      heatPlan = state.plan
      heatCells = buildHeatCells(heatPlan)
      heatColors = new Uint8ClampedArray(heatPlan ? heatPlan.heatmap.count * 4 : 0)
      heatDirty = true
    }
    if (heatDirty && heatPlan) {
      blendFrames(heatPlan.heatmap, state.hour, heatColors)
      frameKey++
    }
    heatDirty = false
  }

  function fitRoutes(routes: readonly MapRoute[]) {
    // Fit once per trip, when routes first appear. The result's routes replace the streamed ones
    // with the same geometry, and a new submit clears them first.
    const hadRoutes = fittedCount > 0
    fittedCount = routes.length
    if (hadRoutes || routes.length === 0) return
    const b = pathBounds(routes.map((r) => r.path))
    if (!b) return
    map.fitBounds(
      [
        [b.minLon, b.minLat],
        [b.maxLon, b.maxLat],
      ],
      { padding: { top: 48, bottom: 120, left: 48, right: 48 }, duration: 600, maxZoom: 9 },
    )
  }

  function render() {
    frame = 0
    if (!ready) return
    const state = usePlanStore.getState()
    syncHeatmap(state)
    fitRoutes(state.routes)
    const layers = buildLayers({
      routes: state.routes,
      plan: state.plan,
      interval: state.interval,
      hoveredRouteId: state.hoveredRouteId,
      selectedRouteId: state.selectedRouteId,
      heatCells,
      heatColors,
      frameKey,
      beforeId,
      onHoverRoute: setHoveredRoute,
      onClickRoute: selectRoute,
    })
    overlay.setProps({ layers })
    debug.layers = layers.map((l) => l.id)
    debug.frameKey = frameKey
    debug.renders++
  }

  function schedule() {
    if (frame === 0) frame = requestAnimationFrame(render)
  }

  const unsubscribe = usePlanStore.subscribe((state, prev) => {
    if (state.hour !== prev.hour) heatDirty = true
    if (
      state.hour !== prev.hour ||
      state.plan !== prev.plan ||
      state.routes !== prev.routes ||
      state.interval !== prev.interval ||
      state.hoveredRouteId !== prev.hoveredRouteId ||
      state.selectedRouteId !== prev.selectedRouteId
    ) {
      schedule()
    }
  })

  const onLoad = () => {
    beforeId = firstSymbolLayerId(map)
    ready = true
    schedule()
  }
  if (map.isStyleLoaded()) onLoad()
  else map.once('load', onLoad)

  const canvas = map.getCanvas()
  const onLeave = () => setHoveredRoute(null)
  canvas.addEventListener('mouseleave', onLeave)

  return () => {
    unsubscribe()
    if (frame) cancelAnimationFrame(frame)
    canvas.removeEventListener('mouseleave', onLeave)
    map.off('load', onLoad)
    if (window.spotterScene === debug) delete window.spotterScene
  }
}
