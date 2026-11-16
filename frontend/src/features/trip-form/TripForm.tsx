import { useState, type FormEvent } from 'react'

import type { Place, PlanRequest } from '../../lib/api/types'
import { useApiStatus } from '../../store/apiStatus'
import { usePlanStore } from '../../store/planStore'
import { ERROR, FIELD, LABEL } from '../../ui/fieldStyles'
import { PlaceCombobox } from './PlaceCombobox'
import {
  DEMO_TRIP,
  FEDERAL_GROSS_LIMIT_LB,
  fieldErrorsFromDetails,
  MAX_WEIGHT_LB,
  nextMorningLocal,
  toPlanRequest,
  validateTrip,
  type FieldErrors,
  type TripFormDraft,
} from './schema'

export interface TripFormProps {
  onSubmit: (request: PlanRequest) => void
}

export function TripForm({ onSubmit }: TripFormProps) {
  const [draft, setDraft] = useState<TripFormDraft>(() => ({
    origin: null,
    destination: null,
    departureLocal: nextMorningLocal(),
    loadWeightLb: DEMO_TRIP.loadWeightLb,
    applyHos: false,
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [swaps, setSwaps] = useState(0)
  // Narrow selectors: the form re-renders on phase or error changes, never on slider ticks.
  const busy = usePlanStore((s) => s.phase === 'routing' || s.phase === 'weather')
  // Held while the free API host wakes up (cold-API banner); enabled again once healthz answers.
  const waking = useApiStatus((s) => s.status === 'waking')
  const originTz = usePlanStore((s) => s.originTz)
  const apiError = usePlanStore((s) => s.error)
  const serverErrors: FieldErrors =
    apiError?.code === 'VALIDATION' ? fieldErrorsFromDetails(apiError.details) : {}
  const shown: FieldErrors = { ...serverErrors, ...errors }

  const update = <K extends keyof TripFormDraft>(key: K, value: TripFormDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => {
      if (!(key in e)) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  function submit(next: TripFormDraft) {
    if (waking) return
    const result = validateTrip(next)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(toPlanRequest(result.value))
  }

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit(draft)
  }

  function runDemo() {
    const demo: TripFormDraft = { ...DEMO_TRIP, departureLocal: nextMorningLocal() }
    setDraft(demo)
    submit(demo)
  }

  const canSubmit = draft.origin !== null && draft.destination !== null
  const overLimit = (draft.loadWeightLb ?? 0) > FEDERAL_GROSS_LIMIT_LB

  function swapPlaces() {
    setDraft((d) => ({ ...d, origin: d.destination, destination: d.origin }))
    setErrors((e) => {
      const next = { ...e }
      delete next.origin
      delete next.destination
      return next
    })
    // Remount the comboboxes so their text follows the swapped places (including an empty one).
    setSwaps((n) => n + 1)
  }

  return (
    <form onSubmit={onFormSubmit} noValidate aria-label="Trip" className="flex flex-col gap-4">
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_2.25rem] gap-x-2 gap-y-3 rounded-2xl border border-line bg-surface-2/70 p-3">
        <RouteRail />
        <PlaceCombobox
          key={`origin-${swaps}`}
          label="Origin"
          name="origin"
          placeholder="City or address"
          value={draft.origin}
          onChange={(place: Place | null) => update('origin', place)}
          error={shown.origin}
        />
        <div className="row-span-2 flex items-center justify-center pt-6">
          <button
            type="button"
            onClick={swapPlaces}
            aria-label="Swap origin and destination"
            title="Swap origin and destination"
            disabled={draft.origin === null && draft.destination === null}
            className="group flex size-9 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-sm transition hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-95 disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-2"
          >
            <svg
              key={swaps}
              viewBox="0 0 20 20"
              aria-hidden
              className="size-4 animate-[spin-in_360ms_ease-out]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3v13M6 3L3 6M6 3l3 3M14 17V4M14 17l-3-3M14 17l3-3" />
            </svg>
          </button>
        </div>
        <PlaceCombobox
          key={`destination-${swaps}`}
          label="Destination"
          name="destination"
          placeholder="City or address"
          value={draft.destination}
          onChange={(place: Place | null) => update('destination', place)}
          error={shown.destination}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
        <div>
          <label htmlFor="departure" className={LABEL}>
            Departure{originTz ? ` (${originTz})` : ''}
          </label>
          <input
            id="departure"
            type="datetime-local"
            value={draft.departureLocal}
            onChange={(e) => update('departureLocal', e.target.value)}
            aria-invalid={shown.departureLocal ? true : undefined}
            aria-describedby={shown.departureLocal ? 'departure-error' : undefined}
            className={`${FIELD} px-3`}
          />
          {shown.departureLocal && (
            <p id="departure-error" className={ERROR}>
              {shown.departureLocal}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="weight" className={LABEL}>
            Load weight
          </label>
          <div className="relative">
            <input
              id="weight"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_WEIGHT_LB}
              step={500}
              value={draft.loadWeightLb ?? ''}
              onChange={(e) =>
                update('loadWeightLb', e.target.value === '' ? null : e.target.valueAsNumber)
              }
              aria-invalid={shown.loadWeightLb ? true : undefined}
              aria-describedby={shown.loadWeightLb ? 'weight-error' : 'weight-hint'}
              className={`${FIELD} pr-9 pl-3 tabular-nums`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3">
              lb
            </span>
          </div>
        </div>
        <div className="col-span-2 -mt-1.5">
          {shown.loadWeightLb ? (
            <p id="weight-error" className={ERROR}>
              {shown.loadWeightLb}
            </p>
          ) : overLimit ? (
            <p id="weight-hint" className="text-xs text-amber-700 dark:text-amber-300">
              Over the 80,000 lb federal gross limit
            </p>
          ) : (
            <p id="weight-hint" className="text-xs text-ink-3">
              Loads over 30,000 lb are rated stricter in high wind.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/70 p-3 transition-colors hover:border-line-strong">
        <input
          id="apply-hos"
          type="checkbox"
          checked={draft.applyHos}
          onChange={(e) => update('applyHos', e.target.checked)}
          aria-describedby="apply-hos-hint"
          className="switch mt-0.5"
        />
        <div className="text-sm">
          <label htmlFor="apply-hos" className="block cursor-pointer font-medium text-ink">
            Include hours-of-service breaks
          </label>
          <p id="apply-hos-hint" className="text-xs text-ink-3">
            30 min after 8 h, 10 h rest after 11 h
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit || waking}
          className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:cursor-not-allowed"
        >
          {busy && (
            <span
              aria-hidden
              className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {waking ? 'Waiting for server…' : busy ? 'Planning…' : 'Plan route'}
        </button>
        <button
          type="button"
          onClick={runDemo}
          disabled={waking}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink-2 shadow-sm transition hover:border-accent hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 text-accent" fill="currentColor">
            <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
          </svg>
          Try demo trip
        </button>
      </div>
    </form>
  )
}

/** Origin ring, a dotted road and the destination pin, lined up with the two inputs. */
function RouteRail() {
  return (
    <span aria-hidden className="row-span-2 flex flex-col items-center pt-[2.1rem] pb-[0.9rem]">
      <span className="size-3.5 shrink-0 rounded-full border-[3px] border-accent bg-surface" />
      <span className="my-1 w-0 flex-1 border-l-2 border-dotted border-line-strong" />
      <svg viewBox="0 0 16 20" className="h-5 w-4 shrink-0 text-ink">
        <path d="M8 0a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="currentColor" />
        <circle cx="8" cy="7" r="2.6" fill="var(--surface)" />
      </svg>
    </span>
  )
}
