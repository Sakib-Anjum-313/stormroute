import type { Checkpoint, HosStop } from '../api/types'
import { buildTrack, mileAtTime } from './track'

const T0 = Date.parse('2026-11-15T13:00:00Z') / 1000
const iso = (s: number) => new Date((T0 + s) * 1000).toISOString()
const cp = (mile: number, s: number) => ({ mile, eta_utc: iso(s) }) as Checkpoint

// 0 → 50 → 100 mi at 50 mph, with a 30 min break at mile 80 (after 1.6 h of driving).
const checkpoints = [cp(0, 0), cp(50, 3600), cp(100, 7200 + 1800)]
const stops: HosStop[] = [
  { kind: 'break', mile: 80, lat: 0, lon: 0, start_utc: iso(5760), duration_s: 1800 },
]

test.each([
  ['before departure', -1, Number.NaN],
  ['at departure', 0, 0],
  ['halfway to the first checkpoint', 1800, 25],
  ['at a checkpoint', 3600, 50],
  ['driving toward the stop', 4680, 65],
  ['stop starts', 5760, 80],
  ['parked', 6600, 80],
  ['stop ends', 7560, 80],
  ['after the stop', 8280, 90],
  ['arrival', 9000, 100],
  ['after arrival', 9001, Number.NaN],
])('%s', (_name, s, expected) => {
  const track = buildTrack(checkpoints, stops)
  const mile = mileAtTime(track, T0 + s)
  const shown = Number.isNaN(mile) ? 'off road' : Math.round(mile * 1e6) / 1e6
  expect(shown).toBe(Number.isNaN(expected) ? 'off road' : expected)
})

test('miles never go backwards even if a checkpoint shares the pre-stop time', () => {
  const track = buildTrack([cp(0, 0), cp(80, 5760), cp(100, 9000)], stops)
  for (let i = 1; i < track.mile.length; i++) {
    expect(track.mile[i]).toBeGreaterThanOrEqual(track.mile[i - 1] as number)
    expect(track.tS[i]).toBeGreaterThanOrEqual(track.tS[i - 1] as number)
  }
})

test('an empty track is never on the road', () => {
  expect(mileAtTime(buildTrack([], []), T0)).toBeNaN()
})
