/**
 * Submit flow (PLAN section 10, "Client abort or resubmit"): a resubmit aborts the previous
 * stream silently, only the latest submit writes to the store, and Retry resends the last request.
 */
import { ApiError } from '../../lib/api/errors'
import type { PlanRequest, PlanStreamEvent } from '../../lib/api/types'
import { initialPlanState, usePlanStore } from '../../store/planStore'
import { cancelPlan, fixtureFromUrl, retryPlan, runPlan } from './runPlan'

interface StreamCall {
  request: PlanRequest
  signal: AbortSignal
  emit: (event: PlanStreamEvent) => void
  resolve: () => void
  reject: (error: unknown) => void
}

const calls: StreamCall[] = []

vi.mock('../../lib/api/ndjson', () => ({
  streamPlan: (
    request: PlanRequest,
    options: { signal: AbortSignal; onEvent: (event: PlanStreamEvent) => void },
  ) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ request, signal: options.signal, emit: options.onEvent, resolve, reject })
    }),
}))

const request = (label: string): PlanRequest => ({
  origin: { label, lat: 39.7392, lon: -104.9903 },
  destination: { label: 'Salt Lake City', lat: 40.7608, lon: -111.891 },
  departure_local: '2026-11-15T06:00',
  load_weight_lb: 45_000,
  apply_hos: false,
})

const meta = (tz: string): PlanStreamEvent => ({
  type: 'meta',
  departure_utc: '2026-11-15T13:00:00Z',
  origin_tz: tz,
})

function lastCall(): StreamCall {
  const call = calls.at(-1)
  if (!call) throw new Error('streamPlan was not called')
  return call
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

beforeEach(() => {
  calls.length = 0
  usePlanStore.setState({ ...initialPlanState })
})
afterEach(() => cancelPlan())

test('a resubmit aborts the first stream and ignores its late events and errors', async () => {
  const first = runPlan(request('first'))
  const firstCall = lastCall()
  const second = runPlan(request('second'))
  const secondCall = lastCall()

  expect(firstCall.signal.aborted).toBe(true)
  expect(secondCall.signal.aborted).toBe(false)

  firstCall.emit(meta('America/Chicago')) // late event from the aborted stream
  secondCall.emit(meta('America/Denver'))
  firstCall.reject(ApiError.of('UPSTREAM_TIMEOUT', 'late failure'))
  await first

  const state = usePlanStore.getState()
  expect(state.originTz).toBe('America/Denver')
  expect(state.error).toBeNull()
  expect(state.request?.origin.label).toBe('second')

  secondCall.resolve()
  await second
})

test('an abort is silent', async () => {
  const run = runPlan(request('only'))
  lastCall().reject(abortError())
  await run
  expect(usePlanStore.getState().error).toBeNull()
  expect(usePlanStore.getState().phase).toBe('routing')
})

test('an ApiError fails the plan with its code; anything else becomes INTERNAL', async () => {
  let run = runPlan(request('a'))
  lastCall().reject(ApiError.of('NO_ROUTE', 'none'))
  await run
  expect(usePlanStore.getState()).toMatchObject({ phase: 'error', error: { code: 'NO_ROUTE' } })

  run = runPlan(request('b'))
  lastCall().reject(new TypeError('boom'))
  await run
  expect(usePlanStore.getState()).toMatchObject({ phase: 'error', error: { code: 'INTERNAL' } })
})

test('retryPlan resends the last request', async () => {
  const run = runPlan(request('retry me'))
  lastCall().reject(ApiError.of('UPSTREAM_UNAVAILABLE', 'down'))
  await run

  const retry = retryPlan()
  expect(calls).toHaveLength(2)
  expect(lastCall().request).toEqual(request('retry me'))
  expect(usePlanStore.getState().phase).toBe('routing')
  lastCall().resolve()
  await retry
})

test.each([
  ['?fixture=no_route', 'no_route'],
  ['?fixture=two_routes&x=1', 'two_routes'],
  ['?fixture=bogus', null],
  ['', null],
])('fixtureFromUrl(%j) is %j', (search, expected) => {
  expect(fixtureFromUrl(search)).toBe(expected)
})
