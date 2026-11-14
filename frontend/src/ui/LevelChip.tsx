/**
 * Level swatch and chip. Text always carries the level (never color alone), No Travel adds an
 * octagon icon, and NO_DATA is hatched grey.
 */
import type { RiskLevel } from '../lib/api/types'
import { levelLabel, RISK_HEX } from '../lib/risk/levels'

export function LevelSwatch({
  level,
  className = 'size-2.5',
}: {
  level: RiskLevel | null
  className?: string
}) {
  if (level === null) {
    return (
      <span
        aria-hidden
        className={`hatch-no-data inline-block shrink-0 rounded-[2px] ${className}`}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-[2px] ${className}`}
      style={{ backgroundColor: RISK_HEX[level] }}
    />
  )
}

/** Stop-sign octagon for No Travel. */
export function NoTravelIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
      <path
        d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z"
        fill={RISK_HEX.NO_TRAVEL}
        stroke="white"
        strokeWidth="1"
      />
      <rect x="4" y="7" width="8" height="2" rx="0.5" fill="white" />
    </svg>
  )
}

export function LevelChip({ level }: { level: RiskLevel | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2 py-0.5 text-xs font-medium text-ink">
      {level === 'NO_TRAVEL' ? <NoTravelIcon className="size-3" /> : <LevelSwatch level={level} />}
      {levelLabel(level)}
    </span>
  )
}
