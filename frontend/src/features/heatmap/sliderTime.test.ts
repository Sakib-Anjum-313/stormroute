import { formatSliderTime, keyboardHour, makeSliderFormatter, MAX_HOUR } from './sliderTime'

describe('keyboardHour: whole-hour steps from any fractional position', () => {
  test.each<[string, number, number | null]>([
    ['ArrowRight', 0, 1],
    ['ArrowUp', 4, 5],
    ['ArrowRight', 4.4, 5], // a drag left it between hours: snap forward
    ['ArrowRight', 4.9999999, 6], // float noise below 5 counts as 5, so it steps on
    ['ArrowLeft', 4.4, 4], // ...or back
    ['ArrowDown', 5, 4],
    ['ArrowRight', 47.5, 48],
    ['ArrowRight', MAX_HOUR, MAX_HOUR],
    ['ArrowLeft', 0, 0],
    ['ArrowLeft', 0.3, 0],
    ['PageUp', 10, 16],
    ['PageUp', 45, MAX_HOUR],
    ['PageDown', 10.5, 5],
    ['PageDown', 3, 0],
    ['Home', 30.2, 0],
    ['End', 1, MAX_HOUR],
    ['Enter', 3, null],
    ['a', 3, null],
  ])('%s from %d -> %s', (key, hour, expected) => {
    expect(keyboardHour(key, hour)).toBe(expected)
  })
})

describe('formatSliderTime', () => {
  // 2026-11-15T13:00:00Z = Sun 06:00 MST in Denver.
  const base = Date.UTC(2026, 10, 15, 13) / 1000
  const denver = makeSliderFormatter('America/Denver')

  test.each<[number, string]>([
    [0, 'Sun 06:00 MST · departure'],
    [0.04, 'Sun 06:02 MST · departure'],
    [2.5, 'Sun 08:30 MST · +2.5 h'],
    [9.94, 'Sun 15:56 MST · +9.9 h'],
    [12, 'Sun 18:00 MST · +12 h'],
    [48, 'Tue 06:00 MST · +48 h'],
  ])('hour %d -> %s', (hour, expected) => {
    expect(formatSliderTime(denver, base, hour)).toBe(expected)
  })

  test('an unknown time zone falls back to the browser zone instead of throwing', () => {
    expect(() => makeSliderFormatter('Not/AZone')).not.toThrow()
    expect(formatSliderTime(makeSliderFormatter(null), base, 1)).toMatch(/· \+1\.0 h$/)
  })
})
