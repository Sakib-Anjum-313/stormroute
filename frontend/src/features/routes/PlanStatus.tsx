import type { ApiError } from '../../lib/api/errors'
import { INTERVALS_MI, type IntervalMi } from '../../lib/api/types'
import { setCheckpointInterval, usePlanStore } from '../../store/planStore'
import { retryPlan } from '../trip-form/runPlan'

const ERROR_TEXT: Partial<Record<ApiError['code'], string>> = {
  NO_ROUTE: 'No truck-legal route found. Try a nearby city or address.',
  RATE_LIMITED: 'Too many plans in a minute. Wait a moment and retry.',
  UPSTREAM_RATE_LIMITED: 'The routing or weather service is busy.',
  UPSTREAM_TIMEOUT: 'The routing or weather service timed out.',
  UPSTREAM_UNAVAILABLE: 'The routing or weather service is unavailable.',
}

function ErrorCard({ error }: { error: ApiError }) {
  if (error.code === 'VALIDATION') return null // shown inline on the form fields
  const text = ERROR_TEXT[error.code] ?? error.message
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <p className="font-medium">{text}</p>
      {error.retryAfterS !== null && (
        <p className="mt-1 text-red-700">Retry in about {error.retryAfterS} s.</p>
      )}
      <button
        type="button"
        onClick={() => void retryPlan()}
        className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

function Stage({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  const mark = state === 'done' ? '✓' : state === 'active' ? '…' : '·'
  return (
    <li
      className={state === 'pending' ? 'text-slate-400' : 'text-slate-700'}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <span aria-hidden className="inline-block w-4">
        {mark}
      </span>
      {label}
    </li>
  )
}

/** Stage list driven by the real stream events, then a one-line summary and the warnings. */
export function PlanStatus() {
  const phase = usePlanStore((s) => s.phase)
  const progress = usePlanStore((s) => s.progress)
  const error = usePlanStore((s) => s.error)
  const plan = usePlanStore((s) => s.plan?.plan ?? null)
  const interval = usePlanStore((s) => s.interval)

  if (phase === 'idle') {
    return (
      <p className="text-sm text-slate-600">
        Plan a truck trip to compare three routes by weather risk at the time you will drive each
        stretch.
      </p>
    )
  }
  if (phase === 'error' && error) return <ErrorCard error={error} />

  if (phase === 'routing' || phase === 'weather') {
    const weather =
      phase === 'weather'
        ? progress && progress.total > 0
          ? `Weather ${progress.done}/${progress.total}`
          : 'Weather'
        : 'Weather'
    return (
      <ol aria-label="Planning progress" aria-live="polite" className="space-y-1 text-sm">
        <Stage label="Routing" state={phase === 'routing' ? 'active' : 'done'} />
        <Stage label={weather} state={phase === 'weather' ? 'active' : 'pending'} />
        <Stage label="Scoring" state="pending" />
      </ol>
    )
  }

  if (!plan) return null
  const recommendation = plan.recommendation[interval]
  const recommended = plan.routes.find((r) => r.id === recommendation.route_id)
  return (
    <div className="space-y-3 text-sm">
      <fieldset className="flex gap-1">
        <legend className="sr-only">Checkpoint interval</legend>
        {INTERVALS_MI.map((mi: IntervalMi) => (
          <button
            key={mi}
            type="button"
            aria-pressed={interval === mi}
            onClick={() => setCheckpointInterval(mi)}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:outline-none aria-pressed:border-sky-700 aria-pressed:bg-sky-700 aria-pressed:text-white"
          >
            Every {mi} mi
          </button>
        ))}
      </fieldset>
      <p data-testid="plan-summary" className="text-slate-700">
        {plan.routes.length} routes. Recommended:{' '}
        <strong>{recommended?.label ?? recommendation.route_id}</strong>
        {recommendation.decisive_step && ` (decided by ${recommendation.decisive_step})`}.
      </p>
      {plan.warnings.map((w) => (
        <output
          key={w.code}
          className="block rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900"
        >
          {w.message}
        </output>
      ))}
      {recommendation.all_no_travel && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-red-900">
          No safe route for this departure and load.
        </p>
      )}
    </div>
  )
}
