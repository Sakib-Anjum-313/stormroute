import { cumulativeMiles, decodePolyline6, pointAtMile, slicePath } from './geo'

describe('decodePolyline6', () => {
  test('decodes the reference polyline at 1e6 precision as [lon, lat] pairs', () => {
    // Google's documented example (38.5,-120.2)(40.7,-120.95)(43.252,-126.453), encoded at 1e6.
    const encoded = '_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI'
    expect(Array.from(decodePolyline6(encoded))).toEqual([
      -120.2, 38.5, -120.95, 40.7, -126.453, 43.252,
    ])
  })

  test('rejects a truncated polyline', () => {
    expect(() => decodePolyline6('_izlhA~rlgd')).toThrow(/truncated/)
  })
})

describe('path mileage and slicing', () => {
  // Three points along the equator, 1 degree apart; scaled to exactly 100 mi.
  const path = Float64Array.from([0, 0, 1, 0, 2, 0])
  const cum = cumulativeMiles(path, 100)

  test('cumulative miles are normalized to the reported length', () => {
    expect(cum[0]).toBe(0)
    expect(cum[1]).toBeCloseTo(50, 9)
    expect(cum[2]).toBeCloseTo(100, 9)
  })

  test.each([
    [0, [0, 0]],
    [25, [0.5, 0]],
    [50, [1, 0]],
    [75, [1.5, 0]],
    [100, [2, 0]],
    [130, [2, 0]],
  ])('point at mile %d', (mile, expected) => {
    const [x, y] = pointAtMile(path, cum, mile)
    expect(x).toBeCloseTo(expected[0] ?? 0, 9)
    expect(y).toBeCloseTo(expected[1] ?? 0, 9)
  })

  test.each([
    [25, 75, [0.5, 0, 1, 0, 1.5, 0]],
    [0, 40, [0, 0, 0.8, 0]],
    [60, 70, [1.2, 0, 1.4, 0]],
    [80, 100, [1.6, 0, 2, 0]],
  ])('slice %d-%d mi keeps interpolated ends and interior vertices', (from, to, expected) => {
    const slice = Array.from(slicePath(path, cum, from, to))
    expect(slice).toHaveLength(expected.length)
    slice.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? Number.NaN, 9))
  })
})
