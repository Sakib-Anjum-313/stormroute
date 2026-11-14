import { mileSlices } from './mileage'

const empty = { LOW: 0, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: 0, NO_DATA: 0 }

test.each([
  ['all low', { ...empty, LOW: 534.95 }, [['LOW', 1]]],
  [
    'mixed with no data last',
    { ...empty, LOW: 50, SEVERE: 25, NO_DATA: 25 },
    [
      ['LOW', 0.5],
      ['SEVERE', 0.25],
      [null, 0.25],
    ],
  ],
  ['tiny bucket dropped', { ...empty, LOW: 100, HIGH: 0.04 }, [['LOW', 0.9996]]],
  ['no miles', empty, []],
] as const)('%s', (_name, miles, expected) => {
  const slices = mileSlices(miles)
  expect(slices.map((s) => [s.level, Math.round(s.share * 10000) / 10000])).toEqual(expected)
})
