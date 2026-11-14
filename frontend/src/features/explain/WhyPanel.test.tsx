import { act, render, screen, within } from '@testing-library/react'

import type { Plan } from '../../lib/api/types'
import {
  applyPlanEvent,
  initialPlanState,
  setCheckpointInterval,
  usePlanStore,
} from '../../store/planStore'
import { makePlan } from '../../test/makePlan'
import { WhyPanel } from './WhyPanel'

beforeEach(() => usePlanStore.setState({ ...initialPlanState }))

function planWithSevereDecision(): Plan {
  const plan = makePlan()
  plan.recommendation[10] = {
    route_id: 'B',
    ranking: ['B', 'A'],
    all_no_travel: false,
    steps: ['no_travel_mi', 'severe_mi', 'high_mi', 'avg_risk', 'duration_min'],
    keys: { A: [0, 18.5, 40, 1.12, 100], B: [0, 0, 22.5, 0.91, 120] },
    decided_by: { A: 'severe_mi' },
    decisive_step: 'severe_mi',
  }
  return plan
}

test('renders nothing before a result', () => {
  const { container } = render(<WhyPanel />)
  expect(container).toBeEmptyDOMElement()
})

test('names the decisive step and highlights its cell; follows the interval', () => {
  render(<WhyPanel />)
  act(() => applyPlanEvent({ type: 'result', plan: planWithSevereDecision() }))

  // 25 mi: the fixture's recommendation is decided by travel time.
  expect(screen.getByTestId('why-sentence')).toHaveTextContent(
    'Route A wins at step 4 (Travel time): 1 h 40 min vs Route B 2 h.',
  )
  let decisive = screen.getByRole('row', { current: true })
  expect(within(decisive).getByRole('rowheader')).toHaveTextContent('Travel time')

  act(() => setCheckpointInterval(10))
  expect(screen.getByTestId('why-sentence')).toHaveTextContent(
    'Route B wins at step 1 (Severe miles): 0.0 mi vs Route A 18.5 mi.',
  )
  decisive = screen.getByRole('row', { current: true })
  expect(within(decisive).getByRole('rowheader')).toHaveTextContent('Severe miles')
  const cell = within(decisive).getByText('0.0 mi')
  expect(cell).toHaveAttribute('data-decisive', 'true')
  expect(cell).toHaveTextContent('(decisive)')
  expect(within(decisive).getByText('18.5 mi')).toHaveTextContent('(lost here)')
  expect(screen.getAllByRole('row')).toHaveLength(6) // header + steps 0-4
})
