import type { Recommendation } from '../../lib/api/types'
import { joinList, noWeatherAnywhere, whySentence, whyTable } from './explain'

const steps: Recommendation['steps'] = [
  'no_weather_data',
  'no_travel_mi',
  'severe_mi',
  'high_mi',
  'avg_risk',
  'duration_min',
]

function rec(partial: Partial<Recommendation>): Recommendation {
  return {
    route_id: 'B',
    ranking: ['B', 'A', 'C'],
    all_no_travel: false,
    steps,
    keys: {
      A: [0, 0, 18.5, 40, 1.12, 482],
      B: [0, 0, 0, 22.5, 0.91, 515],
      C: [0, 0, 7, 10, 0.7, 530],
    },
    decided_by: { A: 'severe_mi', C: 'severe_mi' },
    decisive_step: 'severe_mi',
    ...partial,
  }
}

const label = (id: string) => `Route ${id}`

test.each([
  [
    'spec example (step 2)',
    rec({}),
    'Route B wins at step 2 (Severe miles): 0.0 mi vs Route A 18.5 mi and Route C 7.0 mi.',
  ],
  [
    'travel time (step 5)',
    rec({
      route_id: 'A',
      ranking: ['A', 'B', 'C'],
      keys: { A: [0, 0, 0, 0, 0, 453], B: [0, 0, 0, 0, 0, 531], C: [0, 0, 0, 0, 0, 700] },
      decided_by: { B: 'duration_min', C: 'duration_min' },
      decisive_step: 'duration_min',
    }),
    'Route A wins at step 5 (Travel time): 7 h 33 min vs Route B 8 h 51 min and Route C 11 h 40 min.',
  ],
  [
    'a route that lost earlier',
    rec({
      ranking: ['B', 'C', 'A'],
      keys: { A: [0, 12, 0, 0, 2, 400], B: [0, 0, 0, 5, 1.5, 500], C: [0, 0, 0, 5, 1.8, 520] },
      decided_by: { A: 'no_travel_mi', C: 'avg_risk' },
      decisive_step: 'avg_risk',
    }),
    'Route B wins at step 4 (Average risk (0–4)): 1.50 vs Route C 1.80; Route A at step 1 (No Travel miles) already lost.',
  ],
  [
    'full tie',
    rec({
      route_id: 'A',
      ranking: ['A', 'B'],
      keys: { A: [0, 0, 0, 0, 0, 450], B: [0, 0, 0, 0, 0, 450] },
      decided_by: { B: 'route_order' },
      decisive_step: 'route_order',
    }),
    'Route A ties Route B on every step and wins on provider order.',
  ],
  [
    'single route',
    rec({ route_id: 'A', ranking: ['A'], decided_by: {}, decisive_step: null }),
    'Route A is the only route.',
  ],
])('%s', (_name, recommendation, sentence) => {
  expect(whySentence(recommendation, label)).toBe(sentence)
})

test('table marks the decisive row, the winner column, the losing cells and moot rows', () => {
  const rows = whyTable(rec({}), ['A', 'B', 'C'])
  expect(rows.map((r) => [r.index, r.decisive, r.moot])).toEqual([
    [0, false, false],
    [1, false, false],
    [2, true, false],
    [3, false, true],
    [4, false, true],
    [5, false, true],
  ])
  expect(rows[0]?.cells.map((c) => c.text)).toEqual(['No', 'No', 'No'])
  const severe = rows[2]
  expect(severe?.cells.map((c) => [c.routeId, c.text, c.winner, c.lostHere])).toEqual([
    ['A', '18.5 mi', false, true],
    ['B', '0.0 mi', true, false],
    ['C', '7.0 mi', false, true],
  ])
  expect(rows[4]?.cells.map((c) => c.text)).toEqual(['1.12', '0.91', '0.70'])
  expect(rows[5]?.cells.map((c) => c.text)).toEqual(['8 h 2 min', '8 h 35 min', '8 h 50 min'])
})

test('null average risk and route-order ties', () => {
  const rows = whyTable(
    rec({
      keys: { A: [0, 0, 0, 0, null, 10], B: [0, 0, 0, 0, null, 10] },
      decisive_step: 'route_order',
    }),
    ['A', 'B'],
  )
  expect(rows[4]?.cells.map((c) => c.text)).toEqual(['—', '—'])
  expect(rows.some((r) => r.decisive || r.moot)).toBe(false)
})

test('a route without weather data loses at step 0', () => {
  const recommendation = rec({
    route_id: 'B',
    ranking: ['B', 'A'],
    keys: { A: [1, 0, 0, 0, null, 400], B: [0, 0, 12, 40, 2.1, 500] },
    decided_by: { A: 'no_weather_data' },
    decisive_step: 'no_weather_data',
  })
  expect(whySentence(recommendation, label)).toBe(
    'Route B wins at step 0 (No weather data at all): No vs Route A Yes.',
  )
  expect(whyTable(recommendation, ['A', 'B'])[0]?.cells.map((c) => c.text)).toEqual(['Yes', 'No'])
  expect(noWeatherAnywhere(recommendation)).toBe(false)
  expect(
    noWeatherAnywhere(rec({ keys: { A: [1, 0, 0, 0, null, 400], B: [1, 0, 0, 0, null, 9] } })),
  ).toBe(true)
})

test.each([
  [[], ''],
  [['A'], 'A'],
  [['A', 'B'], 'A and B'],
  [['A', 'B', 'C'], 'A, B and C'],
])('joinList(%j)', (items, text) => {
  expect(joinList(items)).toBe(text)
})
