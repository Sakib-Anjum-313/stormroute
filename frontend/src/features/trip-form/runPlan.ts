import { ApiError, isAbortError } from '../../lib/api/errors'
import { streamPlan } from '../../lib/api/ndjson'
import type { FixtureScenario, PlanRequest } from '../../lib/api/types'
import { applyPlanEvent, failPlan, startPlan } from '../../store/planStore'

const FIXTURES: ReadonlySet<string> = new Set<FixtureScenario>([
  'default',
  'two_routes',
  'no_travel_all',
  'upstream_429',
  'no_route',
])

/** `?fixture=no_travel_all` is forwarded as `X-Fixture` (the backend ignores it in live mode). */
export function fixtureFromUrl(search: string = window.location.search): FixtureScenario | null {
  const value = new URLSearchParams(search).get('fixture')
  return value !== null && FIXTURES.has(value) ? (value as FixtureScenario) : null
}

let inFlight: AbortController | null = null
let lastRequest: PlanRequest | null = null

/**
 * Submit a plan. A resubmit aborts the previous request, whose late events and errors are then
 * ignored, so only the latest submit ever writes to the store.
 */
export async function runPlan(request: PlanRequest): Promise<void> {
  inFlight?.abort()
  lastRequest = request
  const controller = new AbortController()
  inFlight = controller
  startPlan()
  const isCurrent = () => inFlight === controller
  try {
    await streamPlan(request, {
      signal: controller.signal,
      fixture: fixtureFromUrl(),
      onEvent: (event) => {
        if (isCurrent()) applyPlanEvent(event)
      },
    })
  } catch (error) {
    if (isAbortError(error) || !isCurrent()) return
    failPlan(error instanceof ApiError ? error : ApiError.of('INTERNAL', 'Something went wrong.'))
  } finally {
    if (isCurrent()) inFlight = null
  }
}

/** Re-send the last request (the error card's Retry button). */
export function retryPlan(): Promise<void> {
  return lastRequest ? runPlan(lastRequest) : Promise.resolve()
}

/** Abort without starting a new request (tests, unmount). */
export function cancelPlan(): void {
  inFlight?.abort()
  inFlight = null
}
