import { NO_DATA_HEX, RISK_HEX, RISK_LABEL, RISK_LEVELS } from '../../lib/risk/levels'

/** Level is never color alone: every swatch has its label. */
export function Legend() {
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
