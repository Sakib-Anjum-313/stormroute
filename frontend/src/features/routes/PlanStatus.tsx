import { INTERVALS_MI, type IntervalMi } from '../../lib/api/types'
import { setCheckpointInterval, usePlanStore } from '../../store/planStore'
import { ErrorCard } from './ErrorCard'

function Stage({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  return (
    <li
      className={`flex items-center gap-2.5 transition-colors ${state === 'pending' ? 'text-ink-3' : state === 'active' ? 'font-medium text-ink' : 'text-ink-2'}`}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <span
        aria-hidden
        className={`flex size-6 items-center justify-center rounded-full transition-colors ${state === 'done' ? 'bg-accent-soft' : state === 'active' ? 'bg-surface' : 'bg-surface-2'}`}
      >
        {state === 'done' ? (
          <svg viewBox="0 0 12 12" className="size-3 animate-[spin-in_300ms_ease-out] text-accent">
            <path d="M2.5 6.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : state === 'active' ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
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
      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong p-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 19c0-6 7-4 7-10s7-4 7-4" strokeDasharray="0.1 3.4" />
            <circle cx="5" cy="19" r="2.2" />
            <path d="M19 2.5a3 3 0 0 0-3 3c0 2.2 3 5.5 3 5.5s3-3.3 3-5.5a3 3 0 0 0-3-3z" />
          </svg>
        </span>
        <p className="text-sm text-ink-2">
          Plan a truck trip to compare three routes by weather risk at the time you will drive each
          stretch.
        </p>
      </div>
    )
  }
  if (phase === 'error' && error) return <ErrorCard error={error} />

  if (phase === 'routing' || phase === 'weather') {
    const weather =
      phase === 'weather' && progress && progress.total > 0
        ? `Weather ${progress.done}/${progress.total}`
        : 'Weather'
    return (
      <ol
        aria-label="Planning progress"
        aria-live="polite"
        className="animate-fade space-y-2 rounded-2xl border border-line bg-surface-2/70 p-3 text-sm"
      >
        <Stage label="Routing" state={phase === 'routing' ? 'active' : 'done'} />
        <Stage label={weather} state={phase === 'weather' ? 'active' : 'pending'} />
        <Stage label="Scoring" state="pending" />
      </ol>
    )
  }

  if (!hasPlan) return null
  const index = INTERVALS_MI.indexOf(interval)
  return (
    <fieldset className="flex items-center gap-3 text-sm">
      <legend className="sr-only">Checkpoint interval</legend>
      <span aria-hidden className="shrink-0 text-xs text-ink-3">
        Weather sample
      </span>
      <span className="relative flex flex-1 rounded-xl bg-surface-2 p-1 ring-1 ring-line">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 rounded-lg bg-accent shadow-sm transition-transform duration-300 ease-out"
          style={{
            width: `calc((100% - 0.5rem) / ${INTERVALS_MI.length})`,
            transform: `translateX(${index * 100}%)`,
          }}
        />
        {INTERVALS_MI.map((mi: IntervalMi) => (
          <button
            key={mi}
            type="button"
            aria-pressed={interval === mi}
            onClick={() => setCheckpointInterval(mi)}
            className="relative flex-1 rounded-lg px-1 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none aria-pressed:font-semibold aria-pressed:text-accent-ink"
          >
            Every {mi} mi
          </button>
        ))}
      </span>
    </fieldset>
  )
}
