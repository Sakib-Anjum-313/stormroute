import { act, render, screen } from '@testing-library/react'

import { ApiError } from '../../lib/api/errors'
import type { Plan } from '../../lib/api/types'
import { applyPlanEvent, failPlan, initialPlanState, usePlanStore } from '../../store/planStore'
import { makePlan } from '../../test/makePlan'
import { ErrorCard } from './ErrorCard'
import { PlanBanners } from './PlanBanners'
import { PlanStatus } from './PlanStatus'

beforeEach(() => usePlanStore.setState({ ...initialPlanState }))

function withNoTravel(all: boolean): Plan {
  const plan = makePlan()
  for (const route of all ? plan.routes : plan.routes.slice(0, 1)) {
    const block = route.intervals[25]
    block.aggregates.miles_by_level.NO_TRAVEL = 12
    const cp = block.checkpoints[1]
    if (!cp) throw new Error('fixture')
    cp.level = 'NO_TRAVEL'
    cp.levels = { wind: 'NO_TRAVEL', rain: 'LOW', snow: 'LOW' }
    cp.triggers = [{ rule: 'load_45_54_over_30k', detail: '' }]
  }
  plan.recommendation[25].all_no_travel = all
  return plan
}

test('No Travel banner names the route, its miles and the cause', () => {
  render(<PlanBanners />)
  act(() => applyPlanEvent({ type: 'result', plan: withNoTravel(false) }))
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('No Travel conditions on Route A')
  expect(alert).toHaveTextContent(
    'Route A has 12.0 mi of No Travel conditions (wind ≥ 45 mph with 45,000 lb).',
  )
})

test('every route No Travel: blocking headline, all routes listed', () => {
  render(<PlanBanners />)
  act(() => applyPlanEvent({ type: 'result', plan: withNoTravel(true) }))
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('No safe route for this departure and load')
  expect(alert).toHaveTextContent('Route B has 12.0 mi')
})

test('one banner per warning code, with the backend message', () => {
  const plan = makePlan()
  plan.warnings = [
    { code: 'FEWER_THAN_3_ROUTES', message: 'Only 2 distinct truck routes exist for this trip.' },
    { code: 'WEATHER_PARTIAL', message: 'Some weather lookups failed.' },
  ]
  render(<PlanBanners />)
  act(() => applyPlanEvent({ type: 'result', plan }))
  expect(screen.getByTestId('warning-FEWER_THAN_3_ROUTES')).toHaveTextContent(
    'Fewer than three routesOnly 2 distinct truck routes exist for this trip.',
  )
  expect(screen.getByTestId('warning-WEATHER_PARTIAL')).toHaveTextContent(
    'Hatched grey checkpoints have no data',
  )
  expect(screen.queryByRole('alert')).toBeNull()
})

test.each([
  ['NO_ROUTE', 'No truck route', 'Try a nearby city or address.'],
  ['UPSTREAM_TIMEOUT', 'Timed out', 'did not answer in time'],
  ['RATE_LIMITED', 'Too many plans', '10 trips a minute'],
] as const)('error card for %s', (code, title, body) => {
  render(<ErrorCard error={ApiError.of(code, 'raw message')} />)
  expect(screen.getByRole('alert')).toHaveTextContent(title)
  expect(screen.getByRole('alert')).toHaveTextContent(body)
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})

test('retry_after_s counts down on the Retry button; INTERNAL shows the reference', () => {
  vi.useFakeTimers()
  render(
    <ErrorCard
      error={
        new ApiError({
          code: 'UPSTREAM_RATE_LIMITED',
          message: 'busy',
          details: {},
          retry_after_s: 3,
        })
      }
    />,
  )
  expect(screen.getByRole('button', { name: 'Retry in 3 s' })).toBeDisabled()
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  vi.useRealTimers()
})

test('INTERNAL error shows the request reference; VALIDATION shows no card', () => {
  render(<PlanStatus />)
  act(() =>
    failPlan(
      new ApiError({
        code: 'INTERNAL',
        message: 'x',
        details: { request_id: 'abc123' },
        retry_after_s: null,
      }),
    ),
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Reference abc123')
  act(() => failPlan(ApiError.of('VALIDATION', 'bad')))
  expect(screen.queryByRole('alert')).toBeNull()
})
