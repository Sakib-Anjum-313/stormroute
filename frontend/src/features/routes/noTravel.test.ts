import type { Checkpoint } from '../../lib/api/types'
import { makePlan } from '../../test/makePlan'
import { noTravelCauses, noTravelLines } from './noTravel'

function cp(partial: Partial<Checkpoint>): Checkpoint {
  return {
    mile: 0,
    lat: 0,
    lon: 0,
    kind: 'interval',
    owned_mi: 10,
    eta_utc: '',
    tz: 'UTC',
    status: 'ok',
    weather: null,
    level: 'NO_TRAVEL',
    score: 4,
    levels: { wind: 'LOW', rain: 'LOW', snow: 'LOW' },
    triggers: [],
    ...partial,
  }
}

test.each([
  [
    'not No Travel',
    cp({ level: 'SEVERE', levels: { wind: 'SEVERE', rain: 'LOW', snow: 'LOW' } }),
    [],
  ],
  [
    'wind ≥ 55',
    cp({
      levels: { wind: 'NO_TRAVEL', rain: 'LOW', snow: 'LOW' },
      triggers: [{ rule: 'wind_55_any_load', detail: '' }],
    }),
    ['wind ≥ 55 mph'],
  ],
  [
    'load rule',
    cp({
      levels: { wind: 'NO_TRAVEL', rain: 'LOW', snow: 'LOW' },
      triggers: [
        { rule: 'wind_band', detail: '' },
        { rule: 'load_45_54_over_30k', detail: '' },
      ],
    }),
    ['wind ≥ 45 mph with 45,000 lb'],
  ],
  [
    'rain and snow',
    cp({ levels: { wind: 'LOW', rain: 'NO_TRAVEL', snow: 'NO_TRAVEL' } }),
    ['rain > 1 in/hr', 'snow > 3 in/hr'],
  ],
  ['no data', cp({ level: null, levels: null, status: 'no_data' }), []],
])('%s', (_name, checkpoint, causes) => {
  expect(noTravelCauses(checkpoint, 45_000)).toEqual(causes)
})

test('lines list only routes with No Travel miles, with deduplicated causes', () => {
  const plan = makePlan()
  const a = plan.routes[0]
  if (!a) throw new Error('fixture')
  a.intervals[25].aggregates.miles_by_level.NO_TRAVEL = 12.5
  a.intervals[25].checkpoints = [
    cp({
      levels: { wind: 'NO_TRAVEL', rain: 'LOW', snow: 'LOW' },
      triggers: [{ rule: 'load_45_54_over_30k', detail: '' }],
    }),
    cp({
      levels: { wind: 'NO_TRAVEL', rain: 'LOW', snow: 'LOW' },
      triggers: [{ rule: 'load_45_54_over_30k', detail: '' }],
    }),
  ]
  expect(noTravelLines(plan, 25)).toEqual([
    { routeId: 'A', label: 'Route A', miles: 12.5, causes: ['wind ≥ 45 mph with 45,000 lb'] },
  ])
  expect(noTravelLines(plan, 10)).toEqual([])
})
