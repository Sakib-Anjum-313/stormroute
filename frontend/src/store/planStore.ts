/**
 * App state: the plan, the slider hour, the checkpoint interval and hover/selection.
 *
 * Components read it with narrow selectors (`usePlanStore(s => s.phase)`), so a slider tick only
 * re-renders subscribers of `hour`. The map and the slider label do not render from it at all:
 * they use `usePlanStore.subscribe` and write to deck.gl or the DOM directly.
 */
import { create } from 'zustand'

import type { ApiError } from '../lib/api/errors'
import type {
  Checkpoint,
  HosStop,
  IntervalMi,
  PlanRequest,
  PlanStreamEvent,
} from '../lib/api/types'
import { decodePlan, decodeRoutes, type DecodedPlan, type MapRoute } from '../lib/plan/decodePlan'

export type Phase = 'idle' | 'routing' | 'weather' | 'done' | 'error'

/** Something on the map with details to show: hovered (tooltip) or clicked (popup). */
export type MapPick =
  | { kind: 'checkpoint'; routeId: string; checkpoint: Checkpoint }
  | { kind: 'stop'; routeId: string; stop: HosStop }
  | { kind: 'place'; role: 'origin' | 'destination'; label: string; lon: number; lat: number }

/** The map position a pick is anchored to. */
export function pickPosition(pick: MapPick): [number, number] {
  switch (pick.kind) {
    case 'checkpoint':
      return [pick.checkpoint.lon, pick.checkpoint.lat]
    case 'stop':
      return [pick.stop.lon, pick.stop.lat]
    case 'place':
      return [pick.lon, pick.lat]
  }
}

/** The object behind a pick, for identity comparisons. */
export function pickTarget(pick: MapPick | null): object | null {
  if (pick === null) return null
  return pick.kind === 'checkpoint' ? pick.checkpoint : pick.kind === 'stop' ? pick.stop : pick
}

export interface PlanState {
  phase: Phase
  /** The request being planned (origin/destination pins, HOS flag while streaming). */
  request: PlanRequest | null
  /** Weather batches done/total while the stream runs. */
  progress: { done: number; total: number } | null
  error: ApiError | null
  originTz: string | null
  departureUtc: string | null
  /** Routes to draw: from the `routes` event first (grey), then from the result. */
  routes: MapRoute[]
  plan: DecodedPlan | null
  /** Slider position in hours after the heatmap base time, fractional, `[0, 48]`. */
  hour: number
  interval: IntervalMi
  hoveredRouteId: string | null
  selectedRouteId: string | null
  /** Map object under the pointer (mini tooltip). */
  hoverPick: MapPick | null
  /** Map object the user clicked (popup with details). */
  pinnedPick: MapPick | null
}

export const initialPlanState: PlanState = {
  phase: 'idle',
  request: null,
  progress: null,
  error: null,
  originTz: null,
  departureUtc: null,
  routes: [],
  plan: null,
  hour: 0,
  interval: 25,
  hoveredRouteId: null,
  selectedRouteId: null,
  hoverPick: null,
  pinnedPick: null,
}

export const usePlanStore = create<PlanState>()(() => ({ ...initialPlanState }))

/** A new submit: clear the previous plan and show the routing stage. */
export function startPlan(request: PlanRequest | null = null): void {
  const { interval } = usePlanStore.getState()
  usePlanStore.setState({ ...initialPlanState, interval, request, phase: 'routing' })
}

/** Apply one NDJSON event. `result` decodes everything the map needs, once. */
export function applyPlanEvent(event: PlanStreamEvent): void {
  switch (event.type) {
    case 'meta':
      usePlanStore.setState({ originTz: event.origin_tz, departureUtc: event.departure_utc })
      return
    case 'routes':
      usePlanStore.setState({ routes: decodeRoutes(event.routes), phase: 'weather' })
      return
    case 'progress':
      usePlanStore.setState({ progress: { done: event.done, total: event.total } })
      return
    case 'result': {
      const plan = decodePlan(event.plan)
      const recommended = event.plan.recommendation[usePlanStore.getState().interval].route_id
      usePlanStore.setState({
        plan,
        routes: plan.routes,
        originTz: event.plan.origin_tz,
        departureUtc: event.plan.departure_utc,
        phase: 'done',
        progress: null,
        selectedRouteId: recommended,
        hour: 0,
      })
      return
    }
    case 'error':
      // The client turns this event into a rejected promise; `failPlan` records it.
      return
  }
}

export function failPlan(error: ApiError): void {
  usePlanStore.setState({ phase: 'error', error, progress: null })
}

export function setHour(hour: number): void {
  const clamped = hour < 0 ? 0 : hour > 48 ? 48 : hour
  if (usePlanStore.getState().hour !== clamped) usePlanStore.setState({ hour: clamped })
}

export function setCheckpointInterval(interval: IntervalMi): void {
  // Checkpoints differ per interval, so a popup for the old set would point at a hidden dot.
  const { pinnedPick, hoverPick } = usePlanStore.getState()
  usePlanStore.setState({
    interval,
    pinnedPick: pinnedPick?.kind === 'checkpoint' ? null : pinnedPick,
    hoverPick: hoverPick?.kind === 'checkpoint' ? null : hoverPick,
  })
}

export function setHoverPick(pick: MapPick | null): void {
  const current = usePlanStore.getState().hoverPick
  if (pickTarget(current) !== pickTarget(pick)) usePlanStore.setState({ hoverPick: pick })
}

/** Open the popup for a pick (selecting its route), or close it with `null`. */
export function pinPick(pick: MapPick | null): void {
  const state = usePlanStore.getState()
  if (pickTarget(state.pinnedPick) === pickTarget(pick)) return
  const routeId = pick && pick.kind !== 'place' ? pick.routeId : state.selectedRouteId
  usePlanStore.setState({ pinnedPick: pick, selectedRouteId: routeId })
}

export function setHoveredRoute(id: string | null): void {
  if (usePlanStore.getState().hoveredRouteId !== id) usePlanStore.setState({ hoveredRouteId: id })
}

export function selectRoute(id: string | null): void {
  if (usePlanStore.getState().selectedRouteId !== id) usePlanStore.setState({ selectedRouteId: id })
}
