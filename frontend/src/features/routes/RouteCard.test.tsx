import { act, fireEvent, render, screen, within } from '@testing-library/react'

import type { Plan } from '../../lib/api/types'
import { decodeRoutes } from '../../lib/plan/decodePlan'
import {
  applyPlanEvent,
  initialPlanState,
  setCheckpointInterval,
  usePlanStore,
} from '../../store/planStore'
import { makePlan } from '../../test/makePlan'
import { RouteCard } from './RouteCard'
import { RouteList } from './RouteList'

beforeEach(() => usePlanStore.setState({ ...initialPlanState }))

function riskyPlan(): Plan {
  const plan = makePlan()
  const a = plan.routes[0]
  if (!a) throw new Error('fixture')
  a.intervals[25].aggregates = {
    miles_by_level: { LOW: 40, MODERATE: 10, HIGH: 0, SEVERE: 25, NO_TRAVEL: 12.5, NO_DATA: 12.5 },
    avg_risk: 1.62,
    max_level: 'NO_TRAVEL',
    checkpoint_count: 6,
  }
  return plan
}

function renderCard(plan: Plan, overrides: Partial<Parameters<typeof RouteCard>[0]> = {}) {
  const [route] = decodeRoutes(plan.routes)
  if (!route) throw new Error('fixture')
  return render(
    <RouteCard
      route={route}
      scored={plan.routes[0] ?? null}
      interval={25}
      recommended
      applyHos={false}
      originTz="America/Denver"
      {...overrides}
    />,
  )
}

test('shows identity, trip numbers, the mileage breakdown and the risk summary', () => {
  renderCard(riskyPlan())
  const card = screen.getByRole('button', { name: /Route A/ })
  expect(within(card).getByText('Recommended')).toBeInTheDocument()
  expect(within(card).getByText('100.0 mi')).toBeInTheDocument()
  expect(within(card).getByText('1 h 40 min')).toBeInTheDocument()
  // 21:00Z in Denver.
  expect(within(card).getByText('Sun 14:00 MST')).toBeInTheDocument()
  // Every non-empty level is labelled with its miles, NO_DATA included, in level order.
  const labels = within(card)
    .getAllByText(/ mi$/)
    .map((el) => el.parentElement?.textContent)
  expect(labels).toEqual(
    expect.arrayContaining([
      'Low 40.0 mi',
      'Moderate 10.0 mi',
      'Severe 25.0 mi',
      'No data 12.5 mi',
    ]),
  )
  expect(within(card).queryByText(/^High /)).toBeNull()
  expect(within(card).getByText('No Travel 12.5 mi')).toBeInTheDocument()
  expect(
    within(card).getByText('Severe 25.0 mi', { selector: 'span.font-semibold' }),
  ).toBeInTheDocument()
  expect(within(card).getByText('1.62')).toBeInTheDocument()
  expect(within(card).getByText('Worst').nextSibling).toHaveTextContent('No Travel')
})

test.each([
  [false, 0, 0, '1 h 40 min'],
  [true, 0, 0, '1 h 40 min, no HOS stops'],
  [true, 1800, 1, '2 h 10 min incl. 30 min HOS (1 stop)'],
  [true, 37800, 2, '12 h 10 min incl. 10 h 30 min HOS (2 stops)'],
])('duration with HOS %s, %s s of stops', (applyHos, stopS, stops, text) => {
  const plan = makePlan()
  const a = plan.routes[0]
  if (!a) throw new Error('fixture')
  a.summary.hos_stop_s = stopS
  a.summary.duration_s += stopS
  a.stops = Array.from({ length: stops }, () => ({
    kind: 'break' as const,
    mile: 50,
    lat: 40,
    lon: -104.5,
    start_utc: '2026-11-15T15:00:00Z',
    duration_s: 1800,
  }))
  renderCard(plan, { applyHos })
  expect(screen.getByText(text)).toBeInTheDocument()
})

test('no badges for a calm route, and no Recommended badge when not recommended', () => {
  renderCard(makePlan(), { recommended: false })
  expect(screen.queryByText('Recommended')).toBeNull()
  expect(screen.queryByText(/^No Travel/)).toBeNull()
  expect(screen.getByText('Worst').nextSibling).toHaveTextContent('Low')
})

test('streaming: trip numbers are shown with a skeleton instead of the risk section', () => {
  renderCard(makePlan(), { scored: null, recommended: false })
  expect(screen.getByText('100.0 mi')).toBeInTheDocument()
  expect(screen.queryByText('Avg risk')).toBeNull()
})

test('hover and click write to the store; selection is reflected with aria-pressed', () => {
  renderCard(makePlan())
  const card = screen.getByRole('button', { name: /Route A/ })
  fireEvent.mouseEnter(card)
  expect(usePlanStore.getState().hoveredRouteId).toBe('A')
  fireEvent.mouseLeave(card)
  expect(usePlanStore.getState().hoveredRouteId).toBeNull()
  expect(card).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(card)
  expect(usePlanStore.getState().selectedRouteId).toBe('A')
  expect(card).toHaveAttribute('aria-pressed', 'true')
})

test('the list shows skeletons while routing and follows the interval toggle', () => {
  const plan = riskyPlan()
  render(<RouteList />)
  act(() => usePlanStore.setState({ phase: 'routing' }))
  expect(screen.getByLabelText('Loading routes')).toBeInTheDocument()

  act(() => applyPlanEvent({ type: 'routes', routes: plan.routes }))
  expect(screen.getAllByRole('button')).toHaveLength(2)
  expect(screen.queryByText('Recommended')).toBeNull()

  act(() => applyPlanEvent({ type: 'result', plan }))
  expect(screen.getByTestId('route-card-A')).toHaveTextContent('No Travel 12.5 mi')
  expect(screen.getByTestId('route-card-A')).toHaveTextContent('Recommended')
  act(() => setCheckpointInterval(10))
  // The 10-mile aggregates of the fixture are all Low.
  expect(screen.getByTestId('route-card-A')).not.toHaveTextContent('No Travel')
})
