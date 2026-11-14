import { HEATMAP_RGBA_BY_BYTE, RISK_RGB } from '../risk/levels'
import { base64ToUint16LE, blendFrames, decodeHeatmap, U16_NO_DATA } from './decodeHeatmap'
import type { Heatmap } from './types'

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Little-endian Uint16 encoding, the same as the backend's `struct.pack('<H')`. */
function b64u16(values: number[]): string {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((v, i) => view.setUint16(i * 2, v, true))
  return b64(bytes)
}

// 3 cells x 2 hours, frame-major (idx = h * count + i).
const LEVELS = [0, 2, 255, 4, 1, 0]
const WIND_X10 = [52, 401, U16_NO_DATA, 563, 300, 0]
const RAIN_X1000 = [0, 120, U16_NO_DATA, 0, 0, 1]
const SNOW_X100 = [0, 0, U16_NO_DATA, 25, 0, 0]

const heatmap: Heatmap = {
  base_time_utc: '2026-11-15T13:00:00Z',
  hours: 2,
  cell_deg: 0.3,
  count: 3,
  lat: [40, 40.3, 40.6],
  lon: [-105, -105.3, -105.6],
  levels_b64: b64(Uint8Array.from(LEVELS)),
  wind_mph_x10_b64: b64u16(WIND_X10),
  rain_in_hr_x1000_b64: b64u16(RAIN_X1000),
  snow_in_hr_x100_b64: b64u16(SNOW_X100),
}

function rgbaOf(byte: number): number[] {
  return Array.from(HEATMAP_RGBA_BY_BYTE.subarray(byte * 4, byte * 4 + 4))
}

describe('decodeHeatmap', () => {
  const decoded = decodeHeatmap(heatmap)

  test('decodes base64 into typed arrays, frame-major', () => {
    expect(Array.from(decoded.levels)).toEqual(LEVELS)
    expect(Array.from(decoded.windMphX10)).toEqual(WIND_X10)
    expect(Array.from(decoded.rainInHrX1000)).toEqual(RAIN_X1000)
    expect(Array.from(decoded.snowInHrX100)).toEqual(SNOW_X100)
    expect(decoded.baseTimeUtcS).toBe(Date.UTC(2026, 10, 15, 13) / 1000)
    expect(Array.from(decoded.lat)).toEqual(heatmap.lat)
  })

  test('precomputes one RGBA frame per hour from the level bytes', () => {
    expect(decoded.rgba).toHaveLength(2 * 3 * 4)
    LEVELS.forEach((byte, i) => {
      expect(Array.from(decoded.rgba.subarray(i * 4, i * 4 + 4))).toEqual(rgbaOf(byte))
    })
  })

  test('maps level bytes to the palette and 255 to the no-data color', () => {
    expect(rgbaOf(0).slice(0, 3)).toEqual([...RISK_RGB.LOW])
    expect(rgbaOf(4).slice(0, 3)).toEqual([...RISK_RGB.NO_TRAVEL])
    expect(rgbaOf(255)).toEqual(rgbaOf(17)) // any unknown byte is no data
    expect(rgbaOf(255)[3]).toBeLessThan(rgbaOf(0)[3] ?? 0)
  })

  test('reads Uint16 as little-endian', () => {
    expect(Array.from(base64ToUint16LE(b64(Uint8Array.from([0x01, 0x02]))))).toEqual([0x0201])
  })

  test('rejects arrays whose length does not match count x hours', () => {
    expect(() => decodeHeatmap({ ...heatmap, count: 4 })).toThrow(/expected/)
  })
})

describe('blendFrames', () => {
  const decoded = decodeHeatmap(heatmap)
  const out = new Uint8ClampedArray(3 * 4)
  const frame = (h: number) => Array.from(decoded.rgba.subarray(h * 12, (h + 1) * 12))

  test.each([
    [0, 0],
    [1, 1],
    [-3, 0],
    [7, 1],
  ])('at hour %d equals frame %d (clamped)', (t, h) => {
    blendFrames(decoded, t, out)
    expect(Array.from(out)).toEqual(frame(h))
  })

  test('crossfades linearly between neighbouring frames', () => {
    blendFrames(decoded, 0.25, out)
    const a = frame(0)
    const b = frame(1)
    // Uint8ClampedArray rounds ties to even, so allow the half unit.
    Array.from(out).forEach((v, i) => {
      const expected = (a[i] ?? 0) * 0.75 + (b[i] ?? 0) * 0.25
      expect(Math.abs(v - expected)).toBeLessThanOrEqual(0.5)
    })
  })
})
