import {
  formatAvgRisk,
  formatDuration,
  formatInHr,
  formatMiles,
  formatMph,
  formatPounds,
  formatTime,
} from './format'

test.each([
  [0, '0 min'],
  [29, '0 min'],
  [30, '1 min'],
  [45 * 60, '45 min'],
  [3600, '1 h'],
  [27184, '7 h 33 min'],
  [79827, '22 h 10 min'],
  [-5, '0 min'],
])('formatDuration(%s) = %s', (seconds, expected) => {
  expect(formatDuration(seconds)).toBe(expected)
})

test.each([
  [534.95, '535.0 mi'],
  [489.67, '489.7 mi'],
  [0, '0.0 mi'],
])('formatMiles(%s) = %s', (mi, expected) => {
  expect(formatMiles(mi)).toBe(expected)
})

test.each([
  [null, '—'],
  [0, '0.00'],
  [1.125, '1.13'],
  [4, '4.00'],
])('formatAvgRisk(%s) = %s', (avg, expected) => {
  expect(formatAvgRisk(avg)).toBe(expected)
})

test.each([
  [null, '—', '—'],
  [0, '0.0 mph', '0 in/hr'],
  [34.9, '34.9 mph', '34.900 in/hr'],
  [0.25, '0.3 mph', '0.250 in/hr'],
])('weather values %s', (value, mph, inHr) => {
  expect(formatMph(value)).toBe(mph)
  expect(formatInHr(value)).toBe(inHr)
})

test('formatTime uses the given zone', () => {
  expect(formatTime('2026-11-15T20:33:04Z', 'America/Denver')).toBe('Sun 13:33 MST')
  expect(formatTime('2026-11-15T20:33:04Z', 'America/Los_Angeles')).toBe('Sun 12:33 PST')
  // An unknown zone falls back to the browser zone instead of throwing.
  expect(formatTime('2026-11-15T20:33:04Z', 'Not/AZone')).toMatch(/^\w{3} \d\d:33 /)
})

test('formatPounds', () => {
  expect(formatPounds(45000)).toBe('45,000 lb')
})
