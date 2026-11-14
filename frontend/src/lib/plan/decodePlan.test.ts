import { makePlan } from '../../test/makePlan'
import { levelRgb } from '../risk/levels'
import { decodePlan, ownedBounds } from './decodePlan'

describe('ownedBounds', () => {
  test.each<[number[], number, Array<[number, number]>]>([
    // The 25-mi example: marks 0, 25, 50, 60 on a 60-mi route.
    [
      [0, 25, 50, 60],
      60,
      [
        [0, 12.5],
        [12.5, 37.5],
        [37.5, 55],
        [55, 60],
      ],
    ],
    [
      [0, 10],
      10,
      [
        [0, 5],
        [5, 10],
      ],
    ],
    [[0], 0, [[0, 0]]],
  ])('marks %j on %d mi', (miles, length, expected) => {
    expect(ownedBounds(miles, length)).toEqual(expected)
  })

  test('bounds tile the route with no gaps', () => {
    const bounds = ownedBounds([0, 50, 100, 150, 175], 175)
    expect(bounds[0]?.[0]).toBe(0)
    expect(bounds.at(-1)?.[1]).toBe(175)
    for (let i = 1; i < bounds.length; i++) expect(bounds[i]?.[0]).toBe(bounds[i - 1]?.[1])
  })
})

describe('decodePlan', () => {
  const raw = makePlan()
  const decoded = decodePlan(raw)

  test('decodes every route path with mileage normalized to the summary', () => {
    expect(decoded.routes.map((r) => r.id)).toEqual(['A', 'B'])
    for (const route of decoded.routes) {
      expect(route.path.length).toBe(route.cumMi.length * 2)
      expect(route.cumMi.at(-1)).toBeCloseTo(route.distanceMi, 9)
    }
  })

  test('keeps one checkpoint array per interval and route, colored by the backend level', () => {
    for (const interval of [10, 25, 50] as const) {
      const source = raw.routes[0]?.intervals[interval].checkpoints ?? []
      const mapped = decoded.checkpoints[interval].A ?? []
      expect(mapped).toHaveLength(source.length)
      mapped.forEach((c, i) => {
        expect(c.level).toBe(source[i]?.level)
        expect(c.color).toEqual(levelRgb(source[i]?.level ?? null))
      })
    }
  })

  test('cuts each route into one colored segment per checkpoint that owns road', () => {
    const segments = decoded.segments[25].A ?? []
    const checkpoints = raw.routes[0]?.intervals[25].checkpoints ?? []
    expect(segments).toHaveLength(checkpoints.length)
    segments.forEach((s, i) => expect(s.color).toEqual(levelRgb(checkpoints[i]?.level ?? null)))
    // Segments start at the origin and end at the destination.
    const route = decoded.routes[0]
    expect(segments[0]?.path[0]).toBeCloseTo(route?.path[0] ?? Number.NaN, 9)
    const last = segments.at(-1)?.path
    expect(last?.at(-2)).toBeCloseTo(route?.path.at(-2) ?? Number.NaN, 9)
  })

  test('decodes the heatmap frames once', () => {
    expect(decoded.heatmap.count).toBe(2)
    expect(decoded.heatmap.rgba).toHaveLength(49 * 2 * 4)
  })
})
