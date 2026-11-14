import type { MapCheckpoint } from '../../lib/plan/decodePlan'
import { interpretPick } from './picking'

const cp = { routeId: 'B', checkpoint: { mile: 10 } } as unknown as MapCheckpoint
const stop = {
  kind: 'break',
  mile: 400,
  lat: 41,
  lon: -108,
  start_utc: '',
  duration_s: 1800,
} as const

test.each([
  ['empty map', { layer: null, object: null }, null, null],
  ['route path', { layer: { id: 'routes' }, object: { id: 'A' } }, 'A', null],
  ['hover path', { layer: { id: 'route-hover' }, object: { id: 'C' } }, 'C', null],
  ['risk segment', { layer: { id: 'route-risk-A-25' }, object: { routeId: 'A' } }, 'A', null],
  ['checkpoint', { layer: { id: 'checkpoints-B' }, object: cp }, 'B', 'checkpoint'],
  ['pinned ring', { layer: { id: 'checkpoint-pinned' }, object: cp }, 'B', 'checkpoint'],
  [
    'HOS stop',
    { layer: { id: 'hos-stops' }, object: { routeId: 'C', stop, position: [-108, 41] } },
    'C',
    'stop',
  ],
  [
    'origin pin',
    {
      layer: { id: 'places' },
      object: { role: 'origin', label: 'Denver', position: [-105, 39.7] },
    },
    null,
    'place',
  ],
])('%s', (_name, info, routeId, kind) => {
  const result = interpretPick(info)
  expect(result.routeId).toBe(routeId)
  expect(result.pick?.kind ?? null).toBe(kind)
})

test('a checkpoint pick carries the backend checkpoint object itself', () => {
  const { pick } = interpretPick({ layer: { id: 'checkpoints-B' }, object: cp })
  expect(pick?.kind === 'checkpoint' && pick.checkpoint).toBe(cp.checkpoint)
})
