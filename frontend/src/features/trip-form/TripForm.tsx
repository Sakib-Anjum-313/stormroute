import { useState, type FormEvent } from 'react'

import type { Place, PlanRequest } from '../../lib/api/types'
import { useApiStatus } from '../../store/apiStatus'
import { usePlanStore } from '../../store/planStore'
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

  return (
    <form onSubmit={onFormSubmit} noValidate aria-label="Trip" className="flex flex-col gap-4">
      <PlaceCombobox
        label="Origin"
        name="origin"
        placeholder="City or address"
        value={draft.origin}
        onChange={(place: Place | null) => update('origin', place)}
        error={shown.origin}
      />
      <PlaceCombobox
        label="Destination"
        name="destination"
        placeholder="City or address"
        value={draft.destination}
        onChange={(place: Place | null) => update('destination', place)}
        error={shown.destination}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
        <div>
          <label htmlFor="departure" className="mb-1 block text-sm font-medium text-slate-700">
            Departure{originTz ? ` (${originTz})` : ''}
          </label>
          <input
            id="departure"
            type="datetime-local"
            value={draft.departureLocal}
            onChange={(e) => update('departureLocal', e.target.value)}
            aria-invalid={shown.departureLocal ? true : undefined}
            aria-describedby={shown.departureLocal ? 'departure-error' : undefined}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/30 aria-invalid:border-red-500"
          />
          {shown.departureLocal && (
            <p id="departure-error" className="mt-1 text-xs text-red-600">
              {shown.departureLocal}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="weight" className="mb-1 block text-sm font-medium text-slate-700">
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
              aria-describedby={shown.loadWeightLb ? 'weight-error' : undefined}
              className="w-full rounded-md border border-slate-300 bg-white py-2 pr-9 pl-2 text-sm shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/30 aria-invalid:border-red-500"
            />
            <span className="pointer-events-none absolute top-2 right-2 text-sm text-slate-500">
              lb
            </span>
          </div>
          {shown.loadWeightLb && (
            <p id="weight-error" className="mt-1 text-xs text-red-600">
              {shown.loadWeightLb}
            </p>
          )}
          {!shown.loadWeightLb && overLimit && (
            <p className="mt-1 text-xs text-amber-700">Over the 80,000 lb federal gross limit</p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={draft.applyHos}
          onChange={(e) => update('applyHos', e.target.checked)}
          className="size-4 accent-sky-700"
        />
        Include hours-of-service breaks (30 min after 8 h, 10 h rest after 11 h)
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit || waking}
          className="flex-1 rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {waking ? 'Waiting for server…' : busy ? 'Planning…' : 'Plan route'}
        </button>
        <button
          type="button"
          onClick={runDemo}
          disabled={waking}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:outline-none"
        >
          Try demo trip
        </button>
      </div>
    </form>
  )
}
