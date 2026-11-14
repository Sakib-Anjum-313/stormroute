/**
 * Turn API payloads into the arrays the map draws. Everything here runs once per `routes` or
 * `result` event, never on interaction, so the slider, interval toggle and hover only swap
 * between precomputed arrays (map-performance skill, rule 6).
 */
import { decodeHeatmap, type DecodedHeatmap } from '../api/decodeHeatmap'
import {
  INTERVALS_MI,
  type Checkpoint,
  type HosStop,
  type IntervalMi,
  type Plan,
  type RiskLevel,
  type StreamRoute,
} from '../api/types'
import { routeHex, routeRgb } from './routeColors'
import { cumulativeMiles, decodePolyline6, slicePath } from '../geo/geo'
import { levelRgb, type Rgb } from '../risk/levels'

export interface MapRoute {
  id: string
  label: string
  /** Position in provider order (A = 0); picks the identity color. */
  index: number
  source: StreamRoute['source']
  summary: StreamRoute['summary']
  stops: HosStop[]
  /** Identity color (not a risk color). */
  hex: string
  rgb: Rgb
  /** Flat `[lon, lat, ...]`. */
  path: Float64Array
  /** Cumulative miles per vertex, normalized to `summary.distance_mi`. */
  cumMi: Float64Array
  distanceMi: number
}

export interface MapCheckpoint {
  routeId: string
  position: [number, number]
  level: RiskLevel | null
  color: Rgb
  checkpoint: Checkpoint
}

/** The stretch of road one checkpoint owns, colored by that checkpoint's level. */
export interface MapSegment {
  routeId: string
  path: Float64Array
  color: Rgb
}

export type ByInterval<T> = Record<IntervalMi, T>

export interface DecodedPlan {
  plan: Plan
  routes: MapRoute[]
  /** `checkpoints[interval][routeId]` */
  checkpoints: ByInterval<Record<string, MapCheckpoint[]>>
  /** `segments[interval][routeId]` */
  segments: ByInterval<Record<string, MapSegment[]>>
  heatmap: DecodedHeatmap
}

export function decodeRoutes(routes: readonly StreamRoute[]): MapRoute[] {
  return routes.map((route, index) => {
    const path = decodePolyline6(route.geometry.value)
    return {
      id: route.id,
      label: route.label,
      index,
      source: route.source,
      summary: route.summary,
      stops: route.stops,
      hex: routeHex(index),
      rgb: routeRgb(index),
      path,
      cumMi: cumulativeMiles(path, route.summary.distance_mi),
      distanceMi: route.summary.distance_mi,
    }
  })
}

/**
 * Mile bounds owned by each checkpoint: halfway to each neighbour, clamped to `[0, L]` (the same
 * rule as the backend's `owned_mi`). Used to cut the route into colored segments.
 */
export function ownedBounds(miles: readonly number[], lengthMi: number): Array<[number, number]> {
  return miles.map((mile, i) => {
    const prev = miles[i - 1]
    const next = miles[i + 1]
    const from = prev === undefined ? 0 : Math.max(0, (prev + mile) / 2)
    const to = next === undefined ? lengthMi : Math.min(lengthMi, (mile + next) / 2)
    return [from, to]
  })
}

function mapCheckpoints(routeId: string, checkpoints: readonly Checkpoint[]): MapCheckpoint[] {
  return checkpoints.map((checkpoint) => ({
    routeId,
    position: [checkpoint.lon, checkpoint.lat],
    level: checkpoint.level,
    color: levelRgb(checkpoint.level),
    checkpoint,
  }))
}

function mapSegments(route: MapRoute, checkpoints: readonly Checkpoint[]): MapSegment[] {
  const bounds = ownedBounds(
    checkpoints.map((c) => c.mile),
    route.distanceMi,
  )
  const segments: MapSegment[] = []
  checkpoints.forEach((checkpoint, i) => {
    const [from, to] = bounds[i] ?? [0, 0]
    if (to <= from) return
    segments.push({
      routeId: route.id,
      path: slicePath(route.path, route.cumMi, from, to),
      color: levelRgb(checkpoint.level),
    })
  })
  return segments
}

function byInterval<T>(make: (interval: IntervalMi) => T): ByInterval<T> {
  return { 10: make(10), 25: make(25), 50: make(50) }
}

export function decodePlan(plan: Plan): DecodedPlan {
  const routes = decodeRoutes(plan.routes)
  const checkpoints = byInterval((interval) =>
    Object.fromEntries(
      plan.routes.map((route) => [
        route.id,
        mapCheckpoints(route.id, route.intervals[interval].checkpoints),
      ]),
    ),
  )
  const segments = byInterval((interval) =>
    Object.fromEntries(
      routes.map((route, i) => {
        const source = plan.routes[i]
        return [route.id, source ? mapSegments(route, source.intervals[interval].checkpoints) : []]
      }),
    ),
  )
  return { plan, routes, checkpoints, segments, heatmap: decodeHeatmap(plan.heatmap) }
}

export { INTERVALS_MI }
