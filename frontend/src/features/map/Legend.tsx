/**
 * Map legend. Level is never color alone: every swatch has its label, No Travel adds its icon and
 * NO_DATA is hatched. The hints restate the risk-rules thresholds for reading the map; nothing here
 * classifies (the backend does).
 */
import type { RiskLevel } from '../../lib/api/types'
import { RISK_LABEL, RISK_LEVELS } from '../../lib/risk/levels'
import { LevelSwatch, NoTravelIcon } from '../../ui/LevelChip'

/** Lower bounds per band (risk-rules skill, section 2); wind in mph, rain and snow in in/hr. */
const HINT: Record<RiskLevel, string> = {
  LOW: 'wind < 25, light precip',
  MODERATE: 'wind 25+ · rain 0.1+ · snow 0.5+',
  HIGH: 'wind 35+ · rain 0.25+ · snow 1+',
  SEVERE: 'wind 45+ · rain 0.5+ · snow 2+',
  NO_TRAVEL: 'wind 55+ · rain >1 · snow >3',
}

function LevelMark({ level }: { level: RiskLevel }) {
  return level === 'NO_TRAVEL' ? (
    <NoTravelIcon className="size-3" />
  ) : (
    <LevelSwatch level={level} className="size-3" />
  )
}

export function Legend({ compact = false }: { compact?: boolean }) {
  if (compact) return <CompactLegend />
  return (
    <div className="pointer-events-auto w-44 rounded-lg border border-line bg-surface/95 px-2.5 py-2 text-xs text-ink-2 shadow backdrop-blur">
      <ul aria-label="Risk levels" className="space-y-0.5">
        {RISK_LEVELS.map((level) => (
          <li key={level} className="flex items-center gap-2">
            <LevelMark level={level} />
            <span className="text-ink">{RISK_LABEL[level]}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <LevelSwatch level={null} className="size-3" />
          <span className="text-ink">No data</span>
        </li>
      </ul>
      <details className="group mt-1.5 border-t border-line pt-1">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded text-[11px] font-medium text-ink-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
          Thresholds &amp; symbols
          <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <dl className="mt-1 space-y-0.5 text-[10px] leading-snug">
          {RISK_LEVELS.map((level) => (
            <div key={level}>
              <dt className="inline font-medium text-ink">{RISK_LABEL[level]}: </dt>
              <dd className="inline text-ink-3">{HINT[level]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-[10px] leading-snug text-ink-3">
          mph · in/hr. Over 40,000 lb, wind 35+ is Severe; over 30,000 lb, wind 45+ is No Travel.
        </p>
        <ul aria-label="Map symbols" className="mt-1.5 space-y-0.5 text-[10px]">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="rounded bg-ink px-1 font-bold text-surface">
              ▶ A
            </span>
            Truck at the slider time
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="rounded bg-ink px-1 font-bold text-surface">
              30m
            </span>
            Hours-of-service stop
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1 w-5 rounded-full bg-[#78808c]" />
            Other routes (click to select)
          </li>
        </ul>
      </details>
    </div>
  )
}

/** Phone layout: one wrapped row at the top of the map. */
function CompactLegend() {
  return (
    <ul
      aria-label="Risk levels"
      className="pointer-events-auto flex max-w-[15rem] flex-wrap gap-x-2 gap-y-0.5 rounded-md border border-line bg-surface/90 px-2 py-1 text-[10px] text-ink-2 shadow"
    >
      {RISK_LEVELS.map((level) => (
        <li key={level} className="flex items-center gap-1">
          <LevelMark level={level} />
          {RISK_LABEL[level]}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <LevelSwatch level={null} className="size-2.5" />
        No data
      </li>
    </ul>
  )
}
