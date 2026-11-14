/**
 * Data for the marker layers: HOS stops, origin/destination pins, route letters and the truck
 * ghosts. Everything is built once per plan or request; on a slider frame `updateGhosts` only
 * rewrites numbers in place (map-performance rules 1 and 3).
 */
import type { HosStop, PlanRequest } from '../../lib/api/types'
import { pointAtMile, pointAtMileInto } from '../../lib/geo/geo'
import type { DecodedPlan, MapRoute } from '../../lib/plan/decodePlan'
import { buildTrack, mileAtTime, type Track } from '../../lib/plan/track'
import { routeIconKey } from './iconAtlas'

export interface StopDatum {
  routeId: string
  stop: HosStop
  position: [number, number]
}

export interface PlaceDatum {
  role: 'origin' | 'destination'
  label: string
  position: [number, number]
}

export interface LabelDatum {
  routeId: string
  icon: string
  position: [number, number]
}

export interface GhostDatum {
  routeId: string
  icon: string
  /** Rewritten in place on every slider frame. */
  position: [number, number]
  visible: boolean
  route: MapRoute
  track: Track
}

export function buildStops(plan: DecodedPlan | null): StopDatum[] {
  if (!plan) return []
  return plan.routes.flatMap((route) =>
    route.stops.map((stop) => ({
      routeId: route.id,
      stop,
      position: [stop.lon, stop.lat] as [number, number],
    })),
  )
}

export function buildPlaces(request: PlanRequest | null): PlaceDatum[] {
  if (!request) return []
  return [
    {
      role: 'origin',
      label: request.origin.label,
      position: [request.origin.lon, request.origin.lat],
    },
    {
      role: 'destination',
      label: request.destination.label,
      position: [request.destination.lon, request.destination.lat],
    },
  ]
}

/**
 * One letter per route, staggered along the route (40 %, 50 %, 60 % …) so routes that share a
 * corridor do not stack their letters.
 */
export function buildLabels(routes: readonly MapRoute[]): LabelDatum[] {
  return routes.map((route, i) => ({
    routeId: route.id,
    icon: routeIconKey('label', route.id),
    position: pointAtMile(route.path, route.cumMi, route.distanceMi * (0.4 + 0.1 * (i % 3))),
  }))
}

/** Ghost tracks come from the 10-mile checkpoints, the densest set of backend ETAs. */
export function buildGhosts(plan: DecodedPlan | null): GhostDatum[] {
  if (!plan) return []
  return plan.routes.map((route, i) => ({
    routeId: route.id,
    icon: routeIconKey('ghost', route.id),
    position: [Number.NaN, Number.NaN],
    visible: false,
    route,
    track: buildTrack(plan.plan.routes[i]?.intervals[10].checkpoints ?? [], route.stops),
  }))
}

/** Move every ghost to epoch second `t`; hidden before departure and after arrival. */
export function updateGhosts(ghosts: readonly GhostDatum[], t: number): void {
  for (const ghost of ghosts) {
    const mile = mileAtTime(ghost.track, t)
    ghost.visible = !Number.isNaN(mile)
    if (ghost.visible) pointAtMileInto(ghost.route.path, ghost.route.cumMi, mile, ghost.position)
  }
}
