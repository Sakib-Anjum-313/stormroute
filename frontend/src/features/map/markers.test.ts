import { decodePlan } from '../../lib/plan/decodePlan'
import { makePlan } from '../../test/makePlan'
import { buildGhosts, buildLabels, buildPlaces, buildStops, updateGhosts } from './markers'

const T0 = Date.parse('2026-11-15T13:00:00Z') / 1000

function plan() {
  const raw = makePlan()
  // Route A: 100 mi due east at 50 mph, so mile m is reached at T0 + m * 72 s.
  const a = raw.routes[0]
  if (!a) throw new Error('fixture')
  for (const cp of a.intervals[10].checkpoints) {
    cp.eta_utc = new Date((T0 + cp.mile * 72) * 1000).toISOString()
  }
  a.stops = [
    {
      kind: 'break',
      mile: 50,
      lat: 40,
      lon: -104.5,
      start_utc: '2026-11-15T14:00:00Z',
      duration_s: 1800,
    },
  ]
  return decodePlan(raw)
}

test.each([
  ['before departure', -60, false, null],
  ['at departure', 0, true, -105],
  ['halfway', 3600, true, -104.5],
  ['at arrival', 7200, true, -104],
  ['after arrival', 7260, false, null],
])('ghost %s', (_name, s, visible, lon) => {
  const ghosts = buildGhosts(plan())
  const ghost = ghosts[0]
  if (!ghost) throw new Error('no ghost')
  const position = ghost.position
  updateGhosts(ghosts, T0 + s)
  expect(ghost.visible).toBe(visible)
  // Updated in place: the same array object deck.gl already holds.
  expect(ghost.position).toBe(position)
  const [x, y] = ghost.position
  expect(ghost.visible ? [Math.round(x * 1000) / 1000, Math.round(y * 1e6) / 1e6] : null).toEqual(
    lon === null ? null : [lon, 40],
  )
})

test('stops, pins and labels', () => {
  const decoded = plan()
  expect(buildStops(decoded)).toEqual([
    { routeId: 'A', stop: decoded.routes[0]?.stops[0], position: [-104.5, 40] },
  ])
  expect(buildStops(null)).toEqual([])
  expect(
    buildPlaces({
      origin: { label: 'Denver', lat: 39.7, lon: -105 },
      destination: { label: 'Salt Lake City', lat: 40.8, lon: -111.9 },
      departure_local: '2026-11-15T06:00',
      load_weight_lb: 45000,
      apply_hos: false,
    }).map((p) => [p.role, p.label, p.position]),
  ).toEqual([
    ['origin', 'Denver', [-105, 39.7]],
    ['destination', 'Salt Lake City', [-111.9, 40.8]],
  ])
  const labels = buildLabels(decoded.routes)
  expect(labels.map((l) => [l.routeId, l.icon])).toEqual([
    ['A', 'label-A'],
    ['B', 'label-B'],
  ])
  // A is labelled at 40 % of its length, B at 50 %.
  expect(labels[0]?.position[0]).toBeCloseTo(-104.6, 3)
  expect(labels[1]?.position[0]).toBeCloseTo(-104.4, 3)
})
