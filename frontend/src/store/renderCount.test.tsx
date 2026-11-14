import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { Profiler, type ReactNode } from 'react'

import { TimeSlider } from '../features/heatmap/TimeSlider'
import { PlanStatus } from '../features/routes/PlanStatus'
import { TripForm } from '../features/trip-form/TripForm'
import { makePlan } from '../test/makePlan'
import {
  applyPlanEvent,
  initialPlanState,
  setCheckpointInterval,
  setHour,
  usePlanStore,
} from './planStore'

/**
 * map-performance rule 3: a slider tick writes `hour` to the store and must not re-render the
 * form, the plan panel or even the slider itself (its label is written to the DOM directly).
 */
test('slider updates do not re-render unrelated components', () => {
  usePlanStore.setState({ ...initialPlanState })
  const commits: Record<string, number> = { form: 0, status: 0, slider: 0 }
  const track = (id: string, children: ReactNode) => (
    <Profiler
      id={id}
      onRender={() => {
        commits[id] = (commits[id] ?? 0) + 1
      }}
    >
      {children}
    </Profiler>
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      {track('form', <TripForm onSubmit={() => {}} />)}
      {track('status', <PlanStatus />)}
      {track('slider', <TimeSlider />)}
    </QueryClientProvider>,
  )

  act(() => applyPlanEvent({ type: 'result', plan: makePlan() }))
  const label = screen.getByText(/departure$/)
  const before = { ...commits }

  act(() => {
    for (let i = 1; i <= 120; i++) setHour(i * 0.4)
  })

  expect(commits).toEqual(before)
  expect(usePlanStore.getState().hour).toBe(48)
  // The label still followed the store, without a React commit.
  expect(label.textContent).toMatch(/\+48 h$/)
  expect(screen.getByLabelText('Hours after departure')).toHaveValue('48')

  // Control: a change the panel does depend on does re-render it.
  act(() => setCheckpointInterval(10))
  expect(commits.status).toBe((before.status ?? 0) + 1)
  expect(commits.form).toBe(before.form)
})
