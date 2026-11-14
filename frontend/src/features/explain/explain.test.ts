import type { Recommendation } from '../../lib/api/types'
import { joinList, whySentence, whyTable } from './explain'

const steps: Recommendation['steps'] = [
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
      A: [0, 18.5, 40, 1.12, 482],
      B: [0, 0, 22.5, 0.91, 515],
      C: [0, 7, 10, 0.7, 530],
    },
    decided_by: { A: 'severe_mi', C: 'severe_mi' },
    decisive_step: 'severe_mi',
    ...partial,
  }
}

const label = (id: string) => `Route ${id}`

test.each([
  [
    'spec example (step 1)',
    rec({}),
    'Route B wins at step 1 (Severe miles): 0.0 mi vs Route A 18.5 mi and Route C 7.0 mi.',
  ],
  [
    'travel time (step 4)',
    rec({
      route_id: 'A',
      ranking: ['A', 'B', 'C'],
      keys: { A: [0, 0, 0, 0, 453], B: [0, 0, 0, 0, 531], C: [0, 0, 0, 0, 700] },
      decided_by: { B: 'duration_min', C: 'duration_min' },
      decisive_step: 'duration_min',
    }),
    'Route A wins at step 4 (Travel time): 7 h 33 min vs Route B 8 h 51 min and Route C 11 h 40 min.',
  ],
  [
    'a route that lost earlier',
    rec({
      ranking: ['B', 'C', 'A'],
      keys: { A: [12, 0, 0, 2, 400], B: [0, 0, 5, 1.5, 500], C: [0, 0, 5, 1.8, 520] },
      decided_by: { A: 'no_travel_mi', C: 'avg_risk' },
      decisive_step: 'avg_risk',
    }),
    'Route B wins at step 3 (Average risk (0–4)): 1.50 vs Route C 1.80; Route A at step 0 (No Travel miles) already lost.',
  ],
  [
    'full tie',
    rec({
      route_id: 'A',
      ranking: ['A', 'B'],
      keys: { A: [0, 0, 0, 0, 450], B: [0, 0, 0, 0, 450] },
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
    [1, true, false],
    [2, false, true],
    [3, false, true],
    [4, false, true],
  ])
  const severe = rows[1]
  expect(severe?.cells.map((c) => [c.routeId, c.text, c.winner, c.lostHere])).toEqual([
    ['A', '18.5 mi', false, true],
    ['B', '0.0 mi', true, false],
    ['C', '7.0 mi', false, true],
  ])
  expect(rows[3]?.cells.map((c) => c.text)).toEqual(['1.12', '0.91', '0.70'])
  expect(rows[4]?.cells.map((c) => c.text)).toEqual(['8 h 2 min', '8 h 35 min', '8 h 50 min'])
})

test('null average risk and route-order ties', () => {
  const rows = whyTable(
    rec({
      keys: { A: [0, 0, 0, null, 10], B: [0, 0, 0, null, 10] },
      decisive_step: 'route_order',
    }),
    ['A', 'B'],
  )
  expect(rows[3]?.cells.map((c) => c.text)).toEqual(['—', '—'])
  expect(rows.some((r) => r.decisive || r.moot)).toBe(false)
})

test.each([
  [[], ''],
  [['A'], 'A'],
  [['A', 'B'], 'A and B'],
  [['A', 'B', 'C'], 'A, B and C'],
])('joinList(%j)', (items, text) => {
  expect(joinList(items)).toBe(text)
})
