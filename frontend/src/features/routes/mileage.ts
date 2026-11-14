/** Mileage-bar slices from a route's `miles_by_level` aggregate (display only, no re-scoring). */
import type { Aggregates, RiskLevel } from '../../lib/api/types'
import { RISK_LEVELS } from '../../lib/risk/levels'

export interface MileSlice {
  /** `null` is the NO_DATA bucket. */
  level: RiskLevel | null
  miles: number
  /** Share of the total, 0-1. */
  share: number
}

/** Non-empty buckets in level order (Low … No Travel, then No data). */
export function mileSlices(milesByLevel: Aggregates['miles_by_level']): MileSlice[] {
  const buckets: Array<[RiskLevel | null, number]> = [
    ...RISK_LEVELS.map((level): [RiskLevel, number] => [level, milesByLevel[level]]),
    [null, milesByLevel.NO_DATA],
  ]
  const total = buckets.reduce((sum, [, mi]) => sum + Math.max(0, mi), 0)
  if (total <= 0) return []
  return buckets
    .filter(([, mi]) => mi > 0.05)
    .map(([level, miles]) => ({ level, miles, share: miles / total }))
}
