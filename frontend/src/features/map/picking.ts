/**
 * One place that turns a deck.gl pick into app state: which route the pointer is over and which
 * object (checkpoint, HOS stop, origin/destination) has details to show. The scene installs it as
 * the overlay's root `onHover`/`onClick`, so layers carry no handlers of their own.
 */
import type { HosStop } from '../../lib/api/types'
import type { MapCheckpoint } from '../../lib/plan/decodePlan'
import type { MapPick } from '../../store/planStore'

/** Data objects of the pickable layers that are not plain routes or checkpoints. */
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

export interface PickInput {
  layer?: { id: string } | null
  object?: unknown
}

export interface PickResult {
  routeId: string | null
  pick: MapPick | null
}

const NOTHING: PickResult = { routeId: null, pick: null }

export function interpretPick(info: PickInput): PickResult {
  const id = info.layer?.id
  const object = info.object
  if (!id || object === null || typeof object !== 'object') return NOTHING
  if (id.startsWith('checkpoints-') || id === 'checkpoint-pinned') {
    const cp = object as MapCheckpoint
    return {
      routeId: cp.routeId,
      pick: { kind: 'checkpoint', routeId: cp.routeId, checkpoint: cp.checkpoint },
    }
  }
  if (id === 'hos-stops') {
    const d = object as StopDatum
    return { routeId: d.routeId, pick: { kind: 'stop', routeId: d.routeId, stop: d.stop } }
  }
  if (id === 'places') {
    const d = object as PlaceDatum
    const [lon, lat] = d.position
    return { routeId: null, pick: { kind: 'place', role: d.role, label: d.label, lon, lat } }
  }
  // Routes, the hover path, risk segments, route labels and ghosts all carry a route id.
  const route = object as { id?: unknown; routeId?: unknown }
  const routeId =
    typeof route.routeId === 'string'
      ? route.routeId
      : typeof route.id === 'string'
        ? route.id
        : null
  return { routeId, pick: null }
}
