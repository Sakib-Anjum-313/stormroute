import { NO_DATA_HEX, RISK_HEX, RISK_LABEL, RISK_LEVELS } from '../../lib/risk/levels'

/** Level is never color alone: every swatch has its label. */
export function Legend({ compact = false }: { compact?: boolean }) {
  if (compact) return <CompactLegend />
  return (
    <ul
      aria-label="Risk levels"
      className="pointer-events-auto space-y-0.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-xs text-slate-700 shadow"
    >
      {RISK_LEVELS.map((level) => (
        <li key={level} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm"
            style={{ backgroundColor: RISK_HEX[level] }}
          />
          {RISK_LABEL[level]}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-3 rounded-sm"
          style={{ backgroundColor: NO_DATA_HEX }}
        />
        No data
      </li>
    </ul>
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
          <span
            aria-hidden
            className="inline-block size-2 rounded-[2px]"
            style={{ backgroundColor: RISK_HEX[level] }}
          />
          {RISK_LABEL[level]}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <span aria-hidden className="hatch-no-data inline-block size-2 rounded-[2px]" />
        No data
      </li>
    </ul>
  )
}
