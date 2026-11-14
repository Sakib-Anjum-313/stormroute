import { decodePlan } from '../../lib/plan/decodePlan'
import { makePlan } from '../../test/makePlan'
import { buildHeatCells, buildLayers, type LayerInput } from './buildLayers'

const plan = decodePlan(makePlan())
const heatCells = buildHeatCells(plan)
const heatColors = new Uint8ClampedArray(plan.heatmap.count * 4)

function input(overrides: Partial<LayerInput> = {}): LayerInput {
  return {
    routes: plan.routes,
    plan,
    interval: 25,
    hoveredRouteId: null,
    selectedRouteId: 'A',
    heatCells,
    heatColors,
    frameKey: 0,
    beforeId: undefined,
    onHoverRoute: () => {},
    onClickRoute: () => {},
    ...overrides,
  }
}

const ids = (layers: ReturnType<typeof buildLayers>) => layers.map((l) => l.id)

test.each([
  ['nothing hovered', null, false],
  ['hovering the selected route', 'A', false],
  ['hovering another route', 'B', true],
])('hover layer: %s', (_name, hoveredRouteId, present) => {
  const layers = buildLayers(input({ hoveredRouteId }))
  expect(ids(layers).includes('route-hover')).toBe(present)
})

test('the hover layer draws the route in its identity color and keeps its data identity', () => {
  const first = buildLayers(input({ hoveredRouteId: 'B' })).find((l) => l.id === 'route-hover')
  const second = buildLayers(input({ hoveredRouteId: 'B', frameKey: 1 })).find(
    (l) => l.id === 'route-hover',
  )
  expect(first?.props.data).toBe(second?.props.data)
  const getColor = first?.props.getColor as (d: unknown) => number[]
  expect(getColor(plan.routes[1])).toEqual([...(plan.routes[1]?.rgb ?? []), 255])
})

test('a slider tick keeps every layer id and data identity', () => {
  const a = buildLayers(input({ frameKey: 1 }))
  const b = buildLayers(input({ frameKey: 2 }))
  expect(ids(b)).toEqual(ids(a))
  b.forEach((layer, i) => expect(layer.props.data).toBe(a[i]?.props.data))
})
