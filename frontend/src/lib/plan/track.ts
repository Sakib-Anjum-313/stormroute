/**
 * Where each truck is at a given time, for the ghosts that follow the slider. Built once per plan
 * from the checkpoint ETAs (the backend's ETAs, HOS stops included) and read on every slider frame
 * without allocating.
 */
import type { Checkpoint, HosStop } from '../api/types'

export interface Track {
  /** Epoch seconds, non-decreasing. */
  tS: Float64Array
  /** Route mile at `tS[i]`, non-decreasing. */
  mile: Float64Array
}

/**
 * Samples are the checkpoints plus each HOS stop's start and end at the stop's mile, so the truck
 * stands still while parked instead of creeping across the stop.
 */
export function buildTrack(checkpoints: readonly Checkpoint[], stops: readonly HosStop[]): Track {
  const samples: Array<[number, number]> = checkpoints.map((c) => [
    Date.parse(c.eta_utc) / 1000,
    c.mile,
  ])
  for (const stop of stops) {
    const start = Date.parse(stop.start_utc) / 1000
    samples.push([start, stop.mile], [start + stop.duration_s, stop.mile])
  }
  samples.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const n = samples.length
  const tS = new Float64Array(n)
  const mile = new Float64Array(n)
  let maxMile = 0
  for (let i = 0; i < n; i++) {
    const [t, m] = samples[i] as [number, number]
    maxMile = Math.max(maxMile, m)
    tS[i] = t
    mile[i] = maxMile
  }
  return { tS, mile }
}

/** Route mile at epoch second `t`, or `NaN` before departure and after arrival. */
export function mileAtTime(track: Track, t: number): number {
  const { tS, mile } = track
  const last = tS.length - 1
  if (last < 0 || t < (tS[0] as number) || t > (tS[last] as number)) return Number.NaN
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((tS[mid] as number) <= t) lo = mid
    else hi = mid - 1
  }
  if (lo === last) return mile[last] as number
  const t0 = tS[lo] as number
  const t1 = tS[lo + 1] as number
  const m0 = mile[lo] as number
  const m1 = mile[lo + 1] as number
  return t1 > t0 ? m0 + ((t - t0) / (t1 - t0)) * (m1 - m0) : m1
}
