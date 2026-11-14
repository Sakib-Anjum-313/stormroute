import { placePopover } from './placement'

const container = { width: 800, height: 600 }
const box = { width: 200, height: 100 }

test.each([
  ['centered above', { x: 400, y: 300 }, { left: 300, top: 186, below: false }],
  ['clamped at the left edge', { x: 20, y: 300 }, { left: 8, top: 186, below: false }],
  ['clamped at the right edge', { x: 790, y: 300 }, { left: 592, top: 186, below: false }],
  ['flipped below near the top', { x: 400, y: 60 }, { left: 300, top: 74, below: true }],
  [
    'below but kept inside the bottom edge',
    { x: 400, y: 100 },
    { left: 300, top: 114, below: true },
  ],
])('%s', (_name, anchor, expected) => {
  expect(placePopover(anchor, box, container)).toEqual(expected)
})

test('a box wider than the container sticks to the left margin', () => {
  expect(placePopover({ x: 50, y: 300 }, { width: 900, height: 100 }, container).left).toBe(8)
})
