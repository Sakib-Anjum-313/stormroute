/**
 * Pure layer factory (map-performance skill). Every call returns new layer instances, but with the
 * same `id`, `data` identity and accessors as the previous call, so deck.gl only diffs props. The
 * heatmap color changes through `updateTriggers` and a reused blend buffer, never new data.
 */
import type { Layer } from '@deck.gl/core'
import { IconLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers'

import type { IntervalMi } from '../../lib/api/types'
import type { DecodedPlan, MapCheckpoint, MapRoute, MapSegment } from '../../lib/plan/decodePlan'
import { ICON_SIZE, type IconAtlas } from './iconAtlas'
import type { GhostDatum, LabelDatum, PlaceDatum, StopDatum } from './markers'

export interface HeatCell {
  polygon: [number, number][]
}

export interface LayerInput {
  routes: readonly MapRoute[]
  plan: DecodedPlan | null
  interval: IntervalMi
  hoveredRouteId: string | null
  selectedRouteId: string | null
  /** Cell polygons built once per plan. */
  heatCells: readonly HeatCell[]
  /** Crossfaded RGBA for the current hour, `count * 4`, reused across ticks. */
  heatColors: Uint8ClampedArray
  /** Bumped after each blend; the only thing that changes on a slider tick. */
  frameKey: number
  /** First basemap symbol layer, so the heatmap sits under the labels. */
  beforeId: string | undefined
  /** The checkpoint whose popup is open (drawn with a ring). */
  pinnedCheckpoint: MapCheckpoint | null
  atlas: IconAtlas
  labels: readonly LabelDatum[]
  stops: readonly StopDatum[]
  places: readonly PlaceDatum[]
  /** Positions rewritten in place each slider frame; `ghostKey` tells deck.gl to re-read them. */
  ghosts: readonly GhostDatum[]
  ghostKey: number
}

type Rgba = [number, number, number, number]
const GREY: Rgba = [120, 128, 140, 255]
const CASING: Rgba = [255, 255, 255, 230]
const STREAMING: [number, number, number, number] = [120, 128, 140, 200]
const OUTLINE: [number, number, number, number] = [255, 255, 255, 255]
const DARK_OUTLINE: [number, number, number, number] = [30, 41, 59, 255]

const getRoutePath = (d: MapRoute) => d.path
const getRouteColor = (d: MapRoute): Rgba => [d.rgb[0], d.rgb[1], d.rgb[2], 255]

/** Stable one-element arrays, so the hover layer keeps its data identity across frames. */
const singletons = new WeakMap<MapRoute, MapRoute[]>()
function singleton(route: MapRoute): MapRoute[] {
  let data = singletons.get(route)
  if (!data) {
    data = [route]
    singletons.set(route, data)
  }
  return data
}
const getSegmentPath = (d: MapSegment) => d.path
const getSegmentColor = (d: MapSegment) => d.color
const getCheckpointPosition = (d: MapCheckpoint) => d.position
const getCheckpointColor = (d: MapCheckpoint) => d.color
const getCellPolygon = (d: HeatCell) => d.polygon
const getMarkerPosition = (d: { position: [number, number] }) => d.position
const getLabelIcon = (d: LabelDatum) => d.icon
const getStopIcon = (d: StopDatum) => (d.stop.kind === 'rest' ? 'stop-rest' : 'stop-break')
const getPlaceIcon = (d: PlaceDatum) => (d.role === 'origin' ? 'pin-origin' : 'pin-destination')
const getGhostIcon = (d: GhostDatum) => d.icon
const getGhostSize = (d: GhostDatum) => (d.visible ? ICON_SIZE.ghost : 0)

const pinnedSingletons = new WeakMap<MapCheckpoint, MapCheckpoint[]>()
function pinnedSingleton(checkpoint: MapCheckpoint): MapCheckpoint[] {
  let data = pinnedSingletons.get(checkpoint)
  if (!data) {
    data = [checkpoint]
    pinnedSingletons.set(checkpoint, data)
  }
  return data
}

/** Build the corridor cell squares once per plan (cell centers ± half a cell). */
export function buildHeatCells(plan: DecodedPlan | null): HeatCell[] {
  if (!plan) return []
  const { lat, lon, cellDeg, count } = plan.heatmap
  const h = cellDeg / 2
  const cells: HeatCell[] = new Array<HeatCell>(count)
  for (let i = 0; i < count; i++) {
    const y = lat[i] as number
    const x = lon[i] as number
    cells[i] = {
      polygon: [
        [x - h, y - h],
        [x + h, y - h],
        [x + h, y + h],
        [x - h, y + h],
      ],
    }
  }
  return cells
}

export function buildLayers(input: LayerInput): Layer[] {
  const { plan, interval, hoveredRouteId, selectedRouteId } = input
  const layers: Layer[] = []

  if (plan && input.heatCells.length > 0) {
    const colors = input.heatColors
    layers.push(
      new SolidPolygonLayer<HeatCell>({
        id: 'heatmap',
        data: input.heatCells,
        getPolygon: getCellPolygon,
        // Reads the blend buffer; `target` is deck.gl's reusable output array.
        getFillColor: (_d, { index, target }) => {
          const o = index * 4
          target[0] = colors[o] as number
          target[1] = colors[o + 1] as number
          target[2] = colors[o + 2] as number
          target[3] = colors[o + 3] as number
          return target as [number, number, number, number]
        },
        updateTriggers: { getFillColor: input.frameKey },
        filled: true,
        extruded: false,
        pickable: false,
        ...(input.beforeId ? { beforeId: input.beforeId } : {}),
      }),
    )
  }

  const streaming = plan === null
  // The selected route gets a casing in its identity color, so the risk-colored line on top of it
  // still says which route it is.
  layers.push(
    new PathLayer<MapRoute>({
      id: 'routes-casing',
      data: input.routes,
      getPath: getRoutePath,
      positionFormat: 'XY',
      getColor: (d) => (d.id === selectedRouteId && !streaming ? getRouteColor(d) : CASING),
      getWidth: (d) => (d.id === selectedRouteId && !streaming ? 12 : 8),
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      updateTriggers: {
        getColor: [selectedRouteId, streaming],
        getWidth: [selectedRouteId, streaming],
      },
    }),
    new PathLayer<MapRoute>({
      id: 'routes',
      data: input.routes,
      getPath: getRoutePath,
      positionFormat: 'XY',
      getColor: streaming ? STREAMING : GREY,
      getWidth: 4,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      pickable: true,
      updateTriggers: { getColor: streaming },
    }),
  )

  // Hovering a card or a path draws that route on top in its identity color (unless it is the
  // selected route, which is already drawn on top in risk colors).
  const hovered =
    hoveredRouteId === null ? undefined : input.routes.find((r) => r.id === hoveredRouteId)
  if (hovered && (hovered.id !== selectedRouteId || streaming)) {
    layers.push(
      new PathLayer<MapRoute>({
        id: 'route-hover',
        data: singleton(hovered),
        getPath: getRoutePath,
        positionFormat: 'XY',
        getColor: getRouteColor,
        getWidth: 6,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: true,
      }),
    )
  }

  if (plan && selectedRouteId) {
    const segments = plan.segments[interval][selectedRouteId] ?? []
    layers.push(
      new PathLayer<MapSegment>({
        id: `route-risk-${selectedRouteId}-${interval}`,
        data: segments,
        getPath: getSegmentPath,
        positionFormat: 'XY',
        getColor: getSegmentColor,
        getWidth: hoveredRouteId === selectedRouteId ? 8 : 6,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: true,
        updateTriggers: { getWidth: hoveredRouteId === selectedRouteId },
      }),
    )
  }

  if (plan) {
    // One layer per route; the selected one is drawn last (on top) and larger.
    const ids = plan.routes.map((r) => r.id).filter((id) => id !== selectedRouteId)
    if (selectedRouteId) ids.push(selectedRouteId)
    for (const id of ids) {
      const selected = id === selectedRouteId
      layers.push(
        new ScatterplotLayer<MapCheckpoint>({
          id: `checkpoints-${id}`,
          data: plan.checkpoints[interval][id] ?? [],
          getPosition: getCheckpointPosition,
          getFillColor: getCheckpointColor,
          getLineColor: selected ? DARK_OUTLINE : OUTLINE,
          getRadius: selected ? 6 : 4,
          radiusUnits: 'pixels',
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: selected ? 1.5 : 1,
          opacity: selected ? 1 : 0.75,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 120],
        }),
      )
    }
  }

  if (input.pinnedCheckpoint) {
    layers.push(
      new ScatterplotLayer<MapCheckpoint>({
        id: 'checkpoint-pinned',
        data: pinnedSingleton(input.pinnedCheckpoint),
        getPosition: getCheckpointPosition,
        getFillColor: getCheckpointColor,
        getLineColor: DARK_OUTLINE,
        getRadius: 9,
        radiusUnits: 'pixels',
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
        pickable: true,
      }),
    )
  }

  const { atlas } = input
  const icons = { iconAtlas: atlas.url, iconMapping: atlas.mapping, sizeUnits: 'pixels' as const }
  if (plan && input.labels.length > 0) {
    layers.push(
      new IconLayer<LabelDatum>({
        id: 'route-labels',
        data: input.labels,
        ...icons,
        getIcon: getLabelIcon,
        getPosition: getMarkerPosition,
        getSize: ICON_SIZE.label,
        pickable: true,
      }),
    )
  }
  if (input.stops.length > 0) {
    layers.push(
      new IconLayer<StopDatum>({
        id: 'hos-stops',
        data: input.stops,
        ...icons,
        getIcon: getStopIcon,
        getPosition: getMarkerPosition,
        getSize: ICON_SIZE.stop,
        pickable: true,
      }),
    )
  }
  if (input.places.length > 0) {
    layers.push(
      new IconLayer<PlaceDatum>({
        id: 'places',
        data: input.places,
        ...icons,
        getIcon: getPlaceIcon,
        getPosition: getMarkerPosition,
        getSize: ICON_SIZE.pin,
        pickable: true,
      }),
    )
  }
  if (input.ghosts.length > 0) {
    layers.push(
      new IconLayer<GhostDatum>({
        id: 'ghosts',
        data: input.ghosts,
        ...icons,
        getIcon: getGhostIcon,
        getPosition: getMarkerPosition,
        getSize: getGhostSize,
        updateTriggers: { getPosition: input.ghostKey, getSize: input.ghostKey },
        pickable: true,
      }),
    )
  }

  return layers
}
