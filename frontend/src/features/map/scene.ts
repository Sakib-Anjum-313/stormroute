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
import type { DecodedPlan, MapCheckpoint, MapRoute } from '../../lib/plan/decodePlan'
import {
  pinPick,
  selectRoute,
  setHoveredRoute,
  setHoverPick,
  usePlanStore,
  type PlanState,
} from '../../store/planStore'
import { useTheme, type Theme } from '../../store/theme'
import { buildHeatCells, buildLayers, type HeatCell } from './buildLayers'
import { getIconAtlas } from './iconAtlas'
import {
  buildGhosts,
  buildLabels,
  buildPlaces,
  buildStops,
  updateGhosts,
  type GhostDatum,
  type LabelDatum,
  type PlaceDatum,
  type StopDatum,
} from './markers'
import { interpretPick, type PickInput } from './picking'

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

export interface Scene {
  /** Swap the basemap style (light/dark) and re-attach the deck layers once it has loaded. */
  setBasemap: (styleUrl: string, theme: Theme) => void
  dispose: () => void
}

export function createScene(map: MaplibreMap, overlay: MapboxOverlay): Scene {
  let beforeId: string | undefined
  let ready = false
  let theme: Theme = useTheme.getState().theme
  let frame = 0
  let heatDirty = true
  let frameKey = 0
  let heatPlan: DecodedPlan | null = null
  let heatCells: HeatCell[] = []
  let heatColors = new Uint8ClampedArray(0)
  let fittedCount = 0
  let markerPlan: DecodedPlan | null = null
  let markerRoutes: readonly MapRoute[] = []
  let markerRequest: PlanState['request'] = null
  let stops: StopDatum[] = []
  let labels: LabelDatum[] = []
  let places: PlaceDatum[] = []
  let ghosts: GhostDatum[] = []
  let ghostKey = 0
  let ghostsDirty = true
  let pinnedFor: PlanState['pinnedPick'] = null
  let pinnedCheckpoint: MapCheckpoint | null = null
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

  /** Marker data per plan/routes/request; per frame only the ghost positions move. */
  function syncMarkers(state: PlanState) {
    if (state.plan !== markerPlan) {
      markerPlan = state.plan
      stops = buildStops(markerPlan)
      ghosts = buildGhosts(markerPlan)
      ghostsDirty = true
    }
    if (state.routes !== markerRoutes) {
      markerRoutes = state.routes
      labels = buildLabels(markerRoutes)
    }
    if (state.request !== markerRequest) {
      markerRequest = state.request
      places = buildPlaces(markerRequest)
    }
    if (ghostsDirty && markerPlan) {
      updateGhosts(ghosts, markerPlan.heatmap.baseTimeUtcS + state.hour * 3600)
      ghostKey++
    }
    ghostsDirty = false
  }

  /** The drawn checkpoint behind the open popup; looked up only when the popup changes. */
  function syncPinned(state: PlanState) {
    if (state.pinnedPick === pinnedFor) return
    pinnedFor = state.pinnedPick
    const pick = state.pinnedPick
    pinnedCheckpoint =
      pick?.kind === 'checkpoint' && state.plan
        ? (state.plan.checkpoints[state.interval][pick.routeId]?.find(
            (c) => c.checkpoint === pick.checkpoint,
          ) ?? null)
        : null
  }

  function render() {
    frame = 0
    if (!ready) return
    const state = usePlanStore.getState()
    syncHeatmap(state)
    fitRoutes(state.routes)
    syncPinned(state)
    syncMarkers(state)
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
      pinnedCheckpoint,
      dark: theme === 'dark',
      atlas: getIconAtlas(),
      labels,
      stops,
      places,
      ghosts,
      ghostKey,
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
    if (state.hour !== prev.hour) {
      heatDirty = true
      ghostsDirty = true
    }
    if (
      state.hour !== prev.hour ||
      state.plan !== prev.plan ||
      state.routes !== prev.routes ||
      state.interval !== prev.interval ||
      state.hoveredRouteId !== prev.hoveredRouteId ||
      state.selectedRouteId !== prev.selectedRouteId ||
      state.pinnedPick !== prev.pinnedPick ||
      state.request !== prev.request
    ) {
      schedule()
    }
  })

  // Root handlers: deck.gl passes the topmost picked object (or none) on every pointer move.
  overlay.setProps({
    onHover: (info: PickInput) => {
      const { routeId, pick } = interpretPick(info)
      setHoveredRoute(routeId)
      setHoverPick(pick)
    },
    onClick: (info: PickInput) => {
      const { routeId, pick } = interpretPick(info)
      if (pick) pinPick(pick)
      else {
        pinPick(null)
        if (routeId) selectRoute(routeId)
      }
    },
  })
  // Panning or zooming moves the anchor of the hover tooltip; drop it until the next hover.
  const onMoveStart = () => setHoverPick(null)
  map.on('movestart', onMoveStart)

  const onLoad = () => {
    beforeId = firstSymbolLayerId(map)
    ready = true
    schedule()
  }
  if (map.isStyleLoaded()) onLoad()
  else map.once('load', onLoad)

  function setBasemap(styleUrl: string, nextTheme: Theme) {
    theme = nextTheme
    // Detach deck's layers first: their `beforeId` names a layer of the old style, which the new
    // style may not have. They come back on `style.load` with the new style's first symbol layer.
    ready = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    overlay.setProps({ layers: [] })
    map.once('style.load', onLoad)
    map.setStyle(styleUrl)
  }

  const canvas = map.getCanvas()
  const onLeave = () => {
    setHoveredRoute(null)
    setHoverPick(null)
  }
  canvas.addEventListener('mouseleave', onLeave)

  const dispose = () => {
    unsubscribe()
    if (frame) cancelAnimationFrame(frame)
    canvas.removeEventListener('mouseleave', onLeave)
    map.off('load', onLoad)
    map.off('movestart', onMoveStart)
    if (window.spotterScene === debug) delete window.spotterScene
  }
  return { setBasemap, dispose }
}
