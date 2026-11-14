/**
 * Pure layer factory (map-performance skill). Every call returns new layer instances, but with the
 * same `id`, `data` identity and accessors as the previous call, so deck.gl only diffs props. The
 * heatmap color changes through `updateTriggers` and a reused blend buffer, never new data.
 */
import type { Layer, PickingInfo } from '@deck.gl/core'
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers'

import type { IntervalMi } from '../../lib/api/types'
import type { DecodedPlan, MapCheckpoint, MapRoute, MapSegment } from '../../lib/plan/decodePlan'

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
  onHoverRoute: (id: string | null) => void
  onClickRoute: (id: string) => void
}

const GREY: [number, number, number, number] = [120, 128, 140, 255]
const GREY_HOVER: [number, number, number, number] = [71, 85, 105, 255]
const CASING: [number, number, number, number] = [255, 255, 255, 230]
const STREAMING: [number, number, number, number] = [120, 128, 140, 200]
const OUTLINE: [number, number, number, number] = [255, 255, 255, 255]
const DARK_OUTLINE: [number, number, number, number] = [30, 41, 59, 255]

const getRoutePath = (d: MapRoute) => d.path
const getSegmentPath = (d: MapSegment) => d.path
const getSegmentColor = (d: MapSegment) => d.color
const getCheckpointPosition = (d: MapCheckpoint) => d.position
const getCheckpointColor = (d: MapCheckpoint) => d.color
const getCellPolygon = (d: HeatCell) => d.polygon

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

function routeIdOf(info: PickingInfo): string | null {
  const object = info.object as { id?: string; routeId?: string } | null | undefined
  return object?.routeId ?? object?.id ?? null
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
  layers.push(
    new PathLayer<MapRoute>({
      id: 'routes-casing',
      data: input.routes,
      getPath: getRoutePath,
      positionFormat: 'XY',
      getColor: CASING,
      getWidth: (d) => (d.id === selectedRouteId ? 11 : 8),
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getWidth: selectedRouteId },
    }),
    new PathLayer<MapRoute>({
      id: 'routes',
      data: input.routes,
      getPath: getRoutePath,
      positionFormat: 'XY',
      getColor: (d) => (streaming ? STREAMING : d.id === hoveredRouteId ? GREY_HOVER : GREY),
      getWidth: (d) => (d.id === hoveredRouteId ? 6 : 4),
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      pickable: true,
      onHover: (info) => input.onHoverRoute(routeIdOf(info)),
      onClick: (info) => {
        const id = routeIdOf(info)
        if (id) input.onClickRoute(id)
      },
      updateTriggers: { getColor: [streaming, hoveredRouteId], getWidth: hoveredRouteId },
    }),
  )

  if (plan && selectedRouteId) {
    const segments = plan.segments[interval][selectedRouteId] ?? []
    layers.push(
      new PathLayer<MapSegment>({
        id: `route-risk-${selectedRouteId}-${interval}`,
        data: segments,
        getPath: getSegmentPath,
        positionFormat: 'XY',
        getColor: getSegmentColor,
        getWidth: 6,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: true,
        onHover: (info) => input.onHoverRoute(routeIdOf(info)),
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
          onHover: (info) => input.onHoverRoute(routeIdOf(info)),
        }),
      )
    }
  }

  return layers
}
