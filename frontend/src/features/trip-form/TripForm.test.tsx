import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiError } from '../../lib/api/errors'
import type { GeocodeResult, PlanRequest } from '../../lib/api/types'
import { useApiStatus } from '../../store/apiStatus'
import { failPlan, initialPlanState, usePlanStore } from '../../store/planStore'
import { validateTrip, type TripFormDraft } from './schema'
import { TripForm } from './TripForm'

const PLACES: GeocodeResult[] = [
  { label: 'Denver, CO, USA', lat: 39.7392, lon: -104.9903, kind: 'Geo' },
  { label: 'Salt Lake City, UT, USA', lat: 40.7608, lon: -111.891, kind: 'Geo' },
]

function stubGeocode() {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>((url) => {
    const q = new URL(url, 'http://localhost').searchParams.get('q')?.toLowerCase() ?? ''
    const results = PLACES.filter((p) => p.label.toLowerCase().startsWith(q))
    return Promise.resolve(Response.json({ results }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderForm() {
  const onSubmit = vi.fn<(request: PlanRequest) => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TripForm onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  return { onSubmit, user: userEvent.setup() }
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  typed: string,
  label: string,
) {
  await user.type(screen.getByRole('combobox', { name: field }), typed)
  await user.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => usePlanStore.setState({ ...initialPlanState }))
afterEach(() => vi.unstubAllGlobals())

test('submit stays disabled until both places are picked from suggestions', async () => {
  stubGeocode()
  const { user, onSubmit } = renderForm()
  const submit = screen.getByRole('button', { name: 'Plan route' })
  expect(submit).toBeDisabled()

  await pick(user, 'Origin', 'Denv', 'Denver, CO, USA')
  expect(submit).toBeDisabled()
  await pick(user, 'Destination', 'Salt', 'Salt Lake City, UT, USA')
  expect(submit).toBeEnabled()

  // Editing a picked place un-picks it.
  await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'x')
  expect(submit).toBeDisabled()
  expect(onSubmit).not.toHaveBeenCalled()
})

test('submits a typed plan request', async () => {
  stubGeocode()
  const { user, onSubmit } = renderForm()
  await pick(user, 'Origin', 'Denv', 'Denver, CO, USA')
  await pick(user, 'Destination', 'Salt', 'Salt Lake City, UT, USA')
  const weight = screen.getByLabelText('Load weight')
  await user.clear(weight)
  await user.type(weight, '25000')
  await user.click(screen.getByLabelText(/hours-of-service/))
  await user.click(screen.getByRole('button', { name: 'Plan route' }))

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    origin: { label: 'Denver, CO, USA', lat: 39.7392, lon: -104.9903 },
    destination: { label: 'Salt Lake City, UT, USA', lat: 40.7608, lon: -111.891 },
    load_weight_lb: 25000,
    apply_hos: true,
  })
  expect(onSubmit.mock.calls[0]?.[0].departure_local).toMatch(/^\d{4}-\d{2}-\d{2}T06:00$/)
})

test('shows an inline error for an out-of-range weight and does not submit', async () => {
  stubGeocode()
  const { user, onSubmit } = renderForm()
  await pick(user, 'Origin', 'Denv', 'Denver, CO, USA')
  await pick(user, 'Destination', 'Salt', 'Salt Lake City, UT, USA')
  const weight = screen.getByLabelText('Load weight')
  await user.clear(weight)
  await user.type(weight, '250000')
  await user.click(screen.getByRole('button', { name: 'Plan route' }))

  expect(await screen.findByText('Weight must be at most 200,000 lb')).toBeInTheDocument()
  expect(weight).toHaveAttribute('aria-invalid', 'true')
  expect(onSubmit).not.toHaveBeenCalled()
})

test('server VALIDATION details show inline under their fields, nested ones included', () => {
  renderForm()
  act(() =>
    failPlan(
      new ApiError({
        code: 'VALIDATION',
        message: 'The request is invalid.',
        details: {
          departure_local: ['Departure is in the past.'],
          destination: { lat: ['Ensure this value is less than or equal to 90.'] },
        },
        retry_after_s: null,
      }),
    ),
  )
  expect(screen.getByText('Departure is in the past.')).toBeInTheDocument()
  expect(screen.getByText('Ensure this value is less than or equal to 90.')).toBeInTheDocument()
})

test('shows "No matches" when geocoding finds nothing', async () => {
  stubGeocode()
  const { user } = renderForm()
  await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Atlantis')
  expect(await screen.findByText("No matches for 'Atlantis'")).toBeInTheDocument()
})

test('Enter takes the highlighted top suggestion, never a stale one', async () => {
  stubGeocode()
  const { user } = renderForm()
  const origin = screen.getByRole('combobox', { name: 'Origin' })
  await user.type(origin, 'Den')
  const top = await screen.findByRole('option', { name: 'Denver, CO, USA' })
  expect(top).toHaveAttribute('aria-selected', 'true')
  expect(origin).toHaveAttribute('aria-activedescendant', top.id)

  // Typing again makes the list stale until the new query answers: Enter waits.
  await user.type(origin, 'v{Enter}')
  expect(origin).toHaveValue('Denv')
  expect(screen.getByRole('listbox', { name: 'Origin suggestions', hidden: true })).toHaveAttribute(
    'aria-busy',
    'true',
  )

  await waitFor(() =>
    expect(
      screen.getByRole('listbox', { name: 'Origin suggestions', hidden: true }),
    ).not.toHaveAttribute('aria-busy'),
  )
  await user.keyboard('{Enter}')
  expect(origin).toHaveValue('Denver, CO, USA')
  expect(screen.queryByRole('option')).toBeNull()
})

test('arrow keys move the highlight from the top suggestion', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          results: [
            { label: 'Denver, CO, USA', lat: 39.74, lon: -104.99, kind: 'Geo' },
            { label: 'Denton, TX, USA', lat: 33.21, lon: -97.13, kind: 'Geo' },
          ],
        }),
      ),
    ),
  )
  const { user } = renderForm()
  const origin = screen.getByRole('combobox', { name: 'Origin' })
  await user.type(origin, 'Den')
  await screen.findByRole('option', { name: 'Denton, TX, USA' })
  await user.keyboard('{ArrowDown}{Enter}')
  expect(origin).toHaveValue('Denton, TX, USA')
})

test('does not geocode fewer than 3 characters', async () => {
  const fetchMock = stubGeocode()
  const { user } = renderForm()
  await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'De')
  await new Promise((r) => setTimeout(r, 400))
  expect(fetchMock).not.toHaveBeenCalled()
})

test('the demo button fills and submits the demo trip', async () => {
  const { user, onSubmit } = renderForm()
  await user.click(screen.getByRole('button', { name: 'Try demo trip' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    origin: { label: 'Denver, CO, USA' },
    destination: { label: 'Salt Lake City, UT, USA' },
    load_weight_lb: 45000,
    apply_hos: false,
  })
  expect(screen.getByRole('combobox', { name: 'Origin' })).toHaveValue('Denver, CO, USA')
})

test('the swap button exchanges origin and destination', async () => {
  const { user, onSubmit } = renderForm()
  const swap = screen.getByRole('button', { name: 'Swap origin and destination' })
  expect(swap).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Try demo trip' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

  await user.click(swap)
  expect(screen.getByRole('combobox', { name: 'Origin' })).toHaveValue('Salt Lake City, UT, USA')
  expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('Denver, CO, USA')
  await user.click(screen.getByRole('button', { name: 'Plan route' }))
  expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({
    origin: { label: 'Salt Lake City, UT, USA' },
    destination: { label: 'Denver, CO, USA' },
  })
})

test('swapping with one place empty moves it and clears the other field', async () => {
  stubGeocode()
  const { user } = renderForm()
  await pick(user, 'Origin', 'Denv', 'Denver, CO, USA')
  await user.click(screen.getByRole('button', { name: 'Swap origin and destination' }))
  expect(screen.getByRole('combobox', { name: 'Origin' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('Denver, CO, USA')
  expect(screen.getByRole('button', { name: 'Plan route' })).toBeDisabled()
})

describe('validateTrip', () => {
  const base: TripFormDraft = {
    origin: { label: 'Denver', lat: 39.7392, lon: -104.9903 },
    destination: { label: 'SLC', lat: 40.7608, lon: -111.891 },
    departureLocal: '2026-11-15T06:00',
    loadWeightLb: 45000,
    applyHos: false,
  }

  test.each<[string, Partial<TripFormDraft>, string, string]>([
    ['unpicked origin', { origin: null }, 'origin', 'Pick a place from the suggestions'],
    [
      'missing departure',
      { departureLocal: '' },
      'departureLocal',
      'Enter a departure date and time',
    ],
    ['empty weight', { loadWeightLb: null }, 'loadWeightLb', 'Enter the load weight in pounds'],
    ['zero weight', { loadWeightLb: 0 }, 'loadWeightLb', 'Weight must be at least 1 lb'],
    ['too heavy', { loadWeightLb: 200_001 }, 'loadWeightLb', 'Weight must be at most 200,000 lb'],
    [
      'same place',
      { destination: { label: 'Denver again', lat: 39.74, lon: -104.99 } },
      'destination',
      'Origin and destination must be more than 1 mile apart',
    ],
  ])('%s', (_name, patch, field, message) => {
    expect(validateTrip({ ...base, ...patch })).toEqual({
      ok: false,
      errors: expect.objectContaining({ [field]: message }),
    })
  })

  test('accepts the boundaries 1 lb and 200,000 lb', () => {
    expect(validateTrip({ ...base, loadWeightLb: 1 }).ok).toBe(true)
    expect(validateTrip({ ...base, loadWeightLb: 200_000 }).ok).toBe(true)
  })
})

test('submit and the demo button are held while the server wakes up', async () => {
  usePlanStore.setState({ ...initialPlanState })
  useApiStatus.setState({ status: 'waking' })
  const { onSubmit, user } = renderForm()
  expect(screen.getByRole('button', { name: 'Waiting for server…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Try demo trip' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Try demo trip' }))
  expect(onSubmit).not.toHaveBeenCalled()

  act(() => useApiStatus.setState({ status: 'ready' }))
  await user.click(screen.getByRole('button', { name: 'Try demo trip' }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
})
