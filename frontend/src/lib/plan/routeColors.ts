/**
 * Route identity colors (A, B, C): blue, pink, indigo. They stay clear of the risk hues and were
 * checked with the dataviz validator against the positron basemap (all pairs: CVD ΔE 9.6, normal
 * vision ΔE 18.7). The letter is always drawn with the color, so identity is never color alone.
 */
import type { Rgb } from '../risk/levels'

export const ROUTE_HEX = ['#2a78d6', '#d14b9a', '#40329e'] as const
/** More than three routes never happens (the backend selects at most three); stay neutral. */
const FALLBACK_HEX = '#64748b'

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function routeHex(index: number): string {
  return ROUTE_HEX[index] ?? FALLBACK_HEX
}

export function routeRgb(index: number): Rgb {
  return hexToRgb(routeHex(index))
}
