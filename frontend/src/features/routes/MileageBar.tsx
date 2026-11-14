import type { Aggregates } from '../../lib/api/types'
import { formatMiles } from '../../lib/format/format'
import { levelLabel, RISK_HEX } from '../../lib/risk/levels'
import { LevelSwatch } from '../../ui/LevelChip'
import { mileSlices } from './mileage'

/**
 * Stacked bar of owned miles by level, with a text label per non-empty level underneath, so the
 * bar is never the only carrier of the numbers.
 */
export function MileageBar({ milesByLevel }: { milesByLevel: Aggregates['miles_by_level'] }) {
  const slices = mileSlices(milesByLevel)
  return (
    <span className="block">
      <span aria-hidden className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
        {slices.map((s) => (
          <span
            key={s.level ?? 'NO_DATA'}
            className={`block h-full min-w-[3px] ${s.level === null ? 'hatch-no-data' : ''}`}
            style={{
              flexGrow: s.share,
              ...(s.level === null ? {} : { backgroundColor: RISK_HEX[s.level] }),
            }}
          />
        ))}
      </span>
      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
        {slices.map((s) => (
          <span key={s.level ?? 'NO_DATA'} className="inline-flex items-center gap-1">
            <LevelSwatch level={s.level} className="size-2" />
            {levelLabel(s.level)} <span className="tabular-nums">{formatMiles(s.miles)}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
