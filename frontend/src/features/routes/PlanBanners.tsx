import type { Warning } from '../../lib/api/types'
import { formatMiles } from '../../lib/format/format'
import { usePlanStore } from '../../store/planStore'
import { Banner } from '../../ui/Banner'
import { NoTravelIcon } from '../../ui/LevelChip'
import { joinList } from '../explain/explain'
import { noTravelLines } from './noTravel'

const WARNING_TITLE: Record<Warning['code'], string> = {
  FEWER_THAN_3_ROUTES: 'Fewer than three routes',
  WEATHER_PARTIAL: 'Partial weather data',
  BEYOND_FORECAST_HORIZON: 'Beyond the forecast',
  WEATHER_COARSENED: 'Coarser weather sampling',
  OVER_FEDERAL_GROSS_LIMIT: 'Over the 80,000 lb federal limit',
}

const WARNING_HINT: Partial<Record<Warning['code'], string>> = {
  WEATHER_PARTIAL:
    'Hatched grey checkpoints have no data; they are left out of average risk, so the recommendation is partial.',
  BEYOND_FORECAST_HORIZON: 'Checkpoints past the forecast range show as No data (hatched grey).',
  WEATHER_COARSENED:
    'Weather was looked up on a coarser grid to stay within the free API quota. Checkpoint positions and miles are exact.',
}

/** No Travel and partial-result banners for the finished plan, following the interval toggle. */
export function PlanBanners() {
  const plan = usePlanStore((s) => s.plan?.plan ?? null)
  const interval = usePlanStore((s) => s.interval)
  if (!plan) return null
  const rec = plan.recommendation[interval]
  const lines = noTravelLines(plan, interval)

  return (
    <div className="space-y-2" data-testid="plan-banners">
      {lines.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-950 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100"
        >
          <p className="flex items-center gap-2 font-semibold">
            <NoTravelIcon />
            {rec.all_no_travel
              ? 'No safe route for this departure and load'
              : `No Travel conditions on ${joinList(lines.map((l) => l.label))}`}
          </p>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {lines.map((line) => (
              <li key={line.routeId}>
                {line.label} has {formatMiles(line.miles)} of No Travel conditions
                {line.causes.length > 0 && ` (${line.causes.join('; ')})`}.
              </li>
            ))}
          </ul>
          {rec.all_no_travel && (
            <p className="mt-1 text-[13px]">
              Routes are still ranked by No Travel miles first. Consider a later departure or a
              lighter load.
            </p>
          )}
        </div>
      )}
      {plan.warnings.map((w) => (
        <Banner
          key={w.code}
          tone="warning"
          title={WARNING_TITLE[w.code]}
          testId={`warning-${w.code}`}
        >
          {w.message}
          {WARNING_HINT[w.code] && ` ${WARNING_HINT[w.code]}`}
        </Banner>
      ))}
    </div>
  )
}
