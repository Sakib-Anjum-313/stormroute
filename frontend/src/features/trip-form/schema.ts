import { z } from 'zod'

import type { Place, PlanRequest } from '../../lib/api/types'
import { haversineM, METERS_PER_MILE } from '../../lib/geo/geo'

/** Mirrors the backend's limits (api-contracts skill, POST /api/plan validation). */
export const MIN_WEIGHT_LB = 1
export const MAX_WEIGHT_LB = 200_000
export const FEDERAL_GROSS_LIMIT_LB = 80_000

const place = z.object(
  {
    label: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  },
  { error: 'Pick a place from the suggestions' },
)

export const tripFormSchema = z
  .object({
    origin: place,
    destination: place,
    departureLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { error: 'Enter a departure date and time' }),
    loadWeightLb: z
      .number({ error: 'Enter the load weight in pounds' })
      .min(MIN_WEIGHT_LB, { error: `Weight must be at least ${MIN_WEIGHT_LB} lb` })
      .max(MAX_WEIGHT_LB, {
        error: `Weight must be at most ${MAX_WEIGHT_LB.toLocaleString('en-US')} lb`,
      }),
    applyHos: z.boolean(),
  })
  .refine(
    (v) =>
      haversineM(v.origin.lat, v.origin.lon, v.destination.lat, v.destination.lon) >
      METERS_PER_MILE,
    { error: 'Origin and destination must be more than 1 mile apart', path: ['destination'] },
  )

export type TripFormValues = z.infer<typeof tripFormSchema>

/** Form state before validation: places may be unpicked and the weight may be empty. */
export interface TripFormDraft {
  origin: Place | null
  destination: Place | null
  departureLocal: string
  loadWeightLb: number | null
  applyHos: boolean
}

export type TripFormField =
  'origin' | 'destination' | 'departureLocal' | 'loadWeightLb' | 'applyHos'
export type FieldErrors = Partial<Record<TripFormField, string>>

export function validateTrip(
  draft: TripFormDraft,
): { ok: true; value: TripFormValues } | { ok: false; errors: FieldErrors } {
  const result = tripFormSchema.safeParse(draft)
  if (result.success) return { ok: true, value: result.data }
  const errors: FieldErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !(field in errors)) {
      errors[field as TripFormField] = issue.message
    }
  }
  return { ok: false, errors }
}

export function toPlanRequest(values: TripFormValues): PlanRequest {
  return {
    origin: values.origin,
    destination: values.destination,
    departure_local: values.departureLocal,
    load_weight_lb: values.loadWeightLb,
    apply_hos: values.applyHos,
  }
}

/** Backend VALIDATION `details` use the API's snake_case field names. */
const API_FIELD: Record<string, TripFormField> = {
  origin: 'origin',
  destination: 'destination',
  departure_local: 'departureLocal',
  load_weight_lb: 'loadWeightLb',
  apply_hos: 'applyHos',
}

export function fieldErrorsFromDetails(details: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {}
  for (const [key, value] of Object.entries(details)) {
    const field = API_FIELD[key]
    if (!field) continue
    const message = Array.isArray(value) ? value.map(String).join(' ') : String(value)
    errors[field] = message
  }
  return errors
}

/** `YYYY-MM-DDTHH:MM` for a local wall-clock date (what `<input type="datetime-local">` takes). */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Tomorrow 06:00 in the browser's clock: the default and demo departure. */
export function nextMorningLocal(now: Date = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(6, 0, 0, 0)
  return toDatetimeLocal(d)
}

export const DEMO_TRIP = {
  origin: { label: 'Denver, CO, USA', lat: 39.7392, lon: -104.9903 },
  destination: { label: 'Salt Lake City, UT, USA', lat: 40.7608, lon: -111.891 },
  loadWeightLb: 45_000,
  applyHos: false,
} as const satisfies Omit<TripFormDraft, 'departureLocal'>
