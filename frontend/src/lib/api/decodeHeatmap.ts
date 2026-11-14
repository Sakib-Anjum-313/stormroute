import { HEATMAP_RGBA_BY_BYTE } from '../risk/levels'
import type { Heatmap } from './types'

/** `wind_mph_x10` etc. use this value for "no data". */
export const U16_NO_DATA = 65535

/**
 * The plan's heatmap decoded once: typed arrays for the raw values and one precomputed RGBA frame
 * per hour. Scrubbing only reads these buffers (map-performance skill, rules 1-2).
 */
export interface DecodedHeatmap {
  baseTimeUtcS: number
  hours: number
  count: number
  cellDeg: number
  lat: Float64Array
  lon: Float64Array
  /** Frame-major level bytes: `idx = h * count + i`; 255 = no data. */
  levels: Uint8Array
  windMphX10: Uint16Array
  rainInHrX1000: Uint16Array
  snowInHrX100: Uint16Array
  /** Frame-major RGBA: frame `h` is `rgba.subarray(h * count * 4, (h + 1) * count * 4)`. */
  rgba: Uint8Array
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Little-endian Uint16 regardless of the platform's byte order. */
export function base64ToUint16LE(b64: string): Uint16Array {
  const bytes = base64ToBytes(b64)
  if (bytes.length % 2 !== 0) throw new Error('Uint16 payload has an odd byte length')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Uint16Array(bytes.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = view.getUint16(i * 2, true)
  return out
}

function expectLength(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`heatmap ${name} has ${actual} values, expected ${expected}`)
  }
}

export function decodeHeatmap(heatmap: Heatmap): DecodedHeatmap {
  const { count, hours } = heatmap
  const total = count * hours
  const levels = base64ToBytes(heatmap.levels_b64)
  const windMphX10 = base64ToUint16LE(heatmap.wind_mph_x10_b64)
  const rainInHrX1000 = base64ToUint16LE(heatmap.rain_in_hr_x1000_b64)
  const snowInHrX100 = base64ToUint16LE(heatmap.snow_in_hr_x100_b64)
  expectLength('lat', heatmap.lat.length, count)
  expectLength('lon', heatmap.lon.length, count)
  expectLength('levels', levels.length, total)
  expectLength('wind', windMphX10.length, total)
  expectLength('rain', rainInHrX1000.length, total)
  expectLength('snow', snowInHrX100.length, total)

  const rgba = new Uint8Array(total * 4)
  for (let i = 0; i < total; i++) {
    const src = (levels[i] ?? 255) * 4
    const dst = i * 4
    rgba[dst] = HEATMAP_RGBA_BY_BYTE[src] ?? 0
    rgba[dst + 1] = HEATMAP_RGBA_BY_BYTE[src + 1] ?? 0
    rgba[dst + 2] = HEATMAP_RGBA_BY_BYTE[src + 2] ?? 0
    rgba[dst + 3] = HEATMAP_RGBA_BY_BYTE[src + 3] ?? 0
  }

  return {
    baseTimeUtcS: Date.parse(heatmap.base_time_utc) / 1000,
    hours,
    count,
    cellDeg: heatmap.cell_deg,
    lat: Float64Array.from(heatmap.lat),
    lon: Float64Array.from(heatmap.lon),
    levels,
    windMphX10,
    rainInHrX1000,
    snowInHrX100,
    rgba,
  }
}

/**
 * Crossfade the RGBA frames around fractional hour `t` into `out` (length `count * 4`).
 * `t` is clamped to `[0, hours - 1]`. Allocation-free: this runs on every slider frame.
 */
export function blendFrames(heatmap: DecodedHeatmap, t: number, out: Uint8ClampedArray): void {
  const last = heatmap.hours - 1
  const clamped = t <= 0 ? 0 : t >= last ? last : t
  const lo = Math.floor(clamped)
  const hi = lo < last ? lo + 1 : lo
  const f = clamped - lo
  const stride = heatmap.count * 4
  const a = lo * stride
  const b = hi * stride
  const rgba = heatmap.rgba
  const g = 1 - f
  for (let i = 0; i < stride; i++) {
    out[i] = (rgba[a + i] as number) * g + (rgba[b + i] as number) * f
  }
}
