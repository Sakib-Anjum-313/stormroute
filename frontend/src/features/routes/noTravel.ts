/**
 * The No Travel banner's lines: which routes have No Travel miles at the active interval and why,
 * read from the backend's per-variable levels and triggers (display only, nothing re-classified).
 */
import type { Checkpoint, IntervalMi, Plan } from '../../lib/api/types'
import { formatPounds } from '../../lib/format/format'

export interface NoTravelLine {
  routeId: string
  label: string
  miles: number
  causes: string[]
}

/** Why one No Travel checkpoint is No Travel, in short words. */
export function noTravelCauses(checkpoint: Checkpoint, weightLb: number): string[] {
  const levels = checkpoint.levels
  if (checkpoint.level !== 'NO_TRAVEL' || !levels) return []
  const causes: string[] = []
  if (levels.wind === 'NO_TRAVEL') {
    causes.push(
      checkpoint.triggers.some((t) => t.rule === 'load_45_54_over_30k')
        ? `wind ≥ 45 mph with ${formatPounds(weightLb)}`
        : 'wind ≥ 55 mph',
    )
  }
  if (levels.rain === 'NO_TRAVEL') causes.push('rain > 1 in/hr')
  if (levels.snow === 'NO_TRAVEL') causes.push('snow > 3 in/hr')
  return causes
}

export function noTravelLines(plan: Plan, interval: IntervalMi): NoTravelLine[] {
  return plan.routes.flatMap((route) => {
    const { checkpoints, aggregates } = route.intervals[interval]
    const miles = aggregates.miles_by_level.NO_TRAVEL
    if (miles <= 0) return []
    const causes = [...new Set(checkpoints.flatMap((c) => noTravelCauses(c, plan.load_weight_lb)))]
    return [{ routeId: route.id, label: route.label, miles, causes }]
  })
}
