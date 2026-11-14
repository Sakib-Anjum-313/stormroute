/**
 * The map's icons (truck ghosts, route letters, HOS stops, origin/destination pins), drawn once on a
 * canvas into one pre-packed atlas, so the IconLayers never load or pack images at runtime
 * (map-performance rule 7). Drawn at 2x for sharp edges on high-DPI screens.
 */
import { ROUTE_HEX } from '../../lib/plan/routeColors'

export interface IconDef {
  x: number
  y: number
  width: number
  height: number
  anchorX: number
  anchorY: number
  mask: false
}

export interface IconAtlas {
  url: string
  mapping: Record<string, IconDef>
}

const SCALE = 2
const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const
const INK = '#0f172a'
const STOP_FILL = '#1e293b'
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** Logical sizes; the IconLayers use the height as `getSize`. */
export const ICON_SIZE = { ghost: 28, label: 22, pin: 34, stop: 20 } as const

type Draw = (ctx: CanvasRenderingContext2D) => void

interface Spec {
  id: string
  w: number
  h: number
  /** Anchor at the bottom center (pins) instead of the center. */
  bottom?: boolean
  draw: Draw
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number) {
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(value, x, y + 0.5)
}

function ghost(color: string, letter: string): Draw {
  return (ctx) => {
    roundRect(ctx, 1.5, 2, 41, 24, 7)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    // Truck: trailer, cab, wheels.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(7, 8, 12, 9)
    roundRect(ctx, 20, 10.5, 6, 6.5, 1.5)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(10.5, 19.5, 2, 0, Math.PI * 2)
    ctx.arc(22.5, 19.5, 2, 0, Math.PI * 2)
    ctx.fill()
    text(ctx, letter, 34, 14, 13)
  }
}

function label(color: string, letter: string): Draw {
  return (ctx) => {
    roundRect(ctx, 1.5, 1.5, 19, 19, 5)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    text(ctx, letter, 11, 11, 12)
  }
}

function pin(destination: boolean): Draw {
  return (ctx) => {
    ctx.beginPath()
    ctx.moveTo(13, 33)
    ctx.bezierCurveTo(9, 26, 2, 20, 2, 12.5)
    ctx.arc(13, 12.5, 11, Math.PI, 0)
    ctx.bezierCurveTo(24, 20, 17, 26, 13, 33)
    ctx.closePath()
    ctx.fillStyle = INK
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    if (destination) {
      // Checkered flag square.
      ctx.fillRect(8, 7.5, 10, 10)
      ctx.fillStyle = INK
      ctx.fillRect(8, 7.5, 5, 5)
      ctx.fillRect(13, 12.5, 5, 5)
    } else {
      ctx.beginPath()
      ctx.arc(13, 12.5, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function stop(caption: string): Draw {
  return (ctx) => {
    roundRect(ctx, 1, 1, 34, 18, 5)
    ctx.fillStyle = STOP_FILL
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    text(ctx, caption, 18, 10, 11)
  }
}

function specs(): Spec[] {
  return [
    ...LETTERS.map((l, i) => ({
      id: `ghost-${l}`,
      w: 44,
      h: 28,
      draw: ghost(ROUTE_HEX[i] ?? '#64748b', l),
    })),
    ...LETTERS.map((l, i) => ({
      id: `label-${l}`,
      w: 22,
      h: 22,
      draw: label(ROUTE_HEX[i] ?? '#64748b', l),
    })),
    { id: 'pin-origin', w: 26, h: 34, bottom: true, draw: pin(false) },
    { id: 'pin-destination', w: 26, h: 34, bottom: true, draw: pin(true) },
    { id: 'stop-break', w: 36, h: 20, draw: stop('30m') },
    { id: 'stop-rest', w: 36, h: 20, draw: stop('10h') },
  ]
}

let atlas: IconAtlas | null = null

/** The atlas, drawn on first use. Without a 2D canvas (tests) the image is empty. */
export function getIconAtlas(): IconAtlas {
  if (atlas) return atlas
  const list = specs()
  const gap = 2
  const width = list.reduce((sum, s) => sum + s.w + gap, 0)
  const height = Math.max(...list.map((s) => s.h))
  const mapping: Record<string, IconDef> = {}
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
  const ctx = canvas?.getContext('2d') ?? null
  if (canvas && ctx) {
    canvas.width = width * SCALE
    canvas.height = height * SCALE
  }
  let x = 0
  for (const spec of list) {
    mapping[spec.id] = {
      x: x * SCALE,
      y: 0,
      width: spec.w * SCALE,
      height: spec.h * SCALE,
      anchorX: (spec.w / 2) * SCALE,
      anchorY: (spec.bottom ? spec.h : spec.h / 2) * SCALE,
      mask: false,
    }
    if (ctx) {
      ctx.save()
      ctx.scale(SCALE, SCALE)
      ctx.translate(x, 0)
      spec.draw(ctx)
      ctx.restore()
    }
    x += spec.w + gap
  }
  atlas = { url: canvas && ctx ? canvas.toDataURL('image/png') : '', mapping }
  return atlas
}

export function routeIconKey(prefix: 'ghost' | 'label', routeId: string): string {
  return `${prefix}-${(LETTERS as readonly string[]).includes(routeId) ? routeId : 'E'}`
}
