/**
 * Display mapping for the backend's risk levels: color and label only. The backend is the
 * authority on classification; nothing here re-classifies (risk-rules skill, section 8).
 */
import type { RiskLevel } from '../api/types'

/** Ordered like the backend's `Level` IntEnum: the index is the score and the heatmap byte. */
export const RISK_LEVELS = [
  'LOW',
  'MODERATE',
  'HIGH',
  'SEVERE',
  'NO_TRAVEL',
] as const satisfies readonly RiskLevel[]

/** The heatmap `levels` byte for a cell without weather data. */
export const HEATMAP_NO_DATA = 255

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  SEVERE: 'Severe',
  NO_TRAVEL: 'No Travel',
}

export const NO_DATA_LABEL = 'No data'

/** Label for a level, or "No data" for a checkpoint without weather (`null` level). */
export function levelLabel(level: RiskLevel | null): string {
  return level === null ? NO_DATA_LABEL : RISK_LABEL[level]
}

export type Rgb = readonly [number, number, number]

/**
 * Risk palette, validated with the dataviz skill's checker against the positron basemap surface
 * (#f2f3f0): lightness band, chroma floor, adjacent CVD separation (worst ΔE 14.3, deutan) and
 * normal-vision separation (worst ΔE 15.3) all pass. The M3 palette failed (Low↔Moderate ΔE 1.8
 * under protanopia). Against the dark basemap the same colors keep both separation checks; only
 * Moderate sits above the dark lightness band, i.e. brighter, which is fine on a dark map. One
 * palette for both themes keeps the heatmap, checkpoints and cards identical. Moderate is below
 * 3:1 on light surfaces, so it is never shown without its text label (relief rule).
 */
export const RISK_HEX: Record<RiskLevel, string> = {
  LOW: '#2e9b6f',
  MODERATE: '#ccb501',
  HIGH: '#d75928',
  SEVERE: '#b0062d',
  NO_TRAVEL: '#7b2a8a',
}

export const NO_DATA_HEX = '#9ca3af'

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const RISK_RGB: Record<RiskLevel, Rgb> = {
  LOW: hexToRgb(RISK_HEX.LOW),
  MODERATE: hexToRgb(RISK_HEX.MODERATE),
  HIGH: hexToRgb(RISK_HEX.HIGH),
  SEVERE: hexToRgb(RISK_HEX.SEVERE),
  NO_TRAVEL: hexToRgb(RISK_HEX.NO_TRAVEL),
}

export const NO_DATA_RGB: Rgb = hexToRgb(NO_DATA_HEX)

/** Color for a checkpoint or segment; `null` level means NO_DATA status. */
export function levelRgb(level: RiskLevel | null): Rgb {
  return level === null ? NO_DATA_RGB : RISK_RGB[level]
}

/**
 * Heatmap fill alpha per level byte (0-4), so calm cells stay a light wash under the routes and
 * worse cells stand out without hiding the basemap and the route checkpoints (No Travel was 190,
 * which buried the routes in an all-No-Travel plan). Index 5 is used for no-data cells.
 */
const HEATMAP_ALPHA = [44, 92, 108, 120, 132, 30] as const

/**
 * RGBA lookup indexed by the heatmap level byte (0-255). Every byte outside 0-4 maps to the
 * no-data color, so a malformed byte can never index out of range.
 */
export const HEATMAP_RGBA_BY_BYTE: Uint8Array = (() => {
  const table = new Uint8Array(256 * 4)
  for (let byte = 0; byte < 256; byte++) {
    const level = RISK_LEVELS[byte]
    const [r, g, b] = level === undefined ? NO_DATA_RGB : RISK_RGB[level]
    const alpha = level === undefined ? HEATMAP_ALPHA[5] : HEATMAP_ALPHA[byte as 0 | 1 | 2 | 3 | 4]
    table.set([r, g, b, alpha], byte * 4)
  }
  return table
})()
