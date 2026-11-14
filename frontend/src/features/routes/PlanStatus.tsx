import { INTERVALS_MI, type IntervalMi } from '../../lib/api/types'
import { setCheckpointInterval, usePlanStore } from '../../store/planStore'
import { ErrorCard } from './ErrorCard'

function Stage({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  return (
    <li
      className={`flex items-center gap-2 ${state === 'pending' ? 'text-ink-3' : 'text-ink-2'}`}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <span aria-hidden className="flex size-4 items-center justify-center">
        {state === 'done' ? (
          <svg viewBox="0 0 12 12" className="size-3 text-accent">
            <path d="M2.5 6.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ) : state === 'active' ? (
          <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      {label}
      <span className="sr-only">
        {state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}
      </span>
    </li>
  )
}

/** Empty-state text, the stage list driven by real stream events, the error card, the interval toggle. */
export function PlanStatus() {
  const phase = usePlanStore((s) => s.phase)
  const progress = usePlanStore((s) => s.progress)
  const error = usePlanStore((s) => s.error)
  const hasPlan = usePlanStore((s) => s.plan !== null)
  const interval = usePlanStore((s) => s.interval)

  if (phase === 'idle') {
    return (
      <p className="text-sm text-ink-2">
        Plan a truck trip to compare three routes by weather risk at the time you will drive each
        stretch.
      </p>
    )
  }
  if (phase === 'error' && error) return <ErrorCard error={error} />

  if (phase === 'routing' || phase === 'weather') {
    const weather =
      phase === 'weather' && progress && progress.total > 0
        ? `Weather ${progress.done}/${progress.total}`
        : 'Weather'
    return (
      <ol aria-label="Planning progress" aria-live="polite" className="space-y-1 text-sm">
        <Stage label="Routing" state={phase === 'routing' ? 'active' : 'done'} />
        <Stage label={weather} state={phase === 'weather' ? 'active' : 'pending'} />
        <Stage label="Scoring" state="pending" />
      </ol>
    )
  }

  if (!hasPlan) return null
  return (
    <fieldset className="flex items-center gap-1 text-sm">
      <legend className="sr-only">Checkpoint interval</legend>
      <span aria-hidden className="mr-1 text-xs text-ink-3">
        Sample
      </span>
      {INTERVALS_MI.map((mi: IntervalMi) => (
        <button
          key={mi}
          type="button"
          aria-pressed={interval === mi}
          onClick={() => setCheckpointInterval(mi)}
          className="flex-1 rounded-md border border-line-strong px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface focus-visible:outline-none aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink"
        >
          Every {mi} mi
        </button>
      ))}
    </fieldset>
  )
}
