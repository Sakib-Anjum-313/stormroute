/** A small, valid synthetic `Plan` for component and decoding tests. */
import type { Checkpoint, Plan, PlanRoute, Recommendation, RiskLevel } from '../lib/api/types'

const LEVEL_BYTE: Record<RiskLevel, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  SEVERE: 3,
  NO_TRAVEL: 4,
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

/** polyline6 for `[lat, lon]` points. */
export function encodePolyline6(points: Array<[number, number]>): string {
  let prevLat = 0
  let prevLon = 0
  let out = ''
  for (const [lat, lon] of points) {
    const a = Math.round(lat * 1e6)
    const b = Math.round(lon * 1e6)
    out += encodeSigned(a - prevLat) + encodeSigned(b - prevLon)
    prevLat = a
    prevLon = b
  }
  return out
}

function checkpoint(mile: number, lengthMi: number, level: RiskLevel | null): Checkpoint {
  const kind = mile === 0 ? 'origin' : mile >= lengthMi ? 'destination' : 'interval'
  return {
    mile,
    lat: 40,
    lon: -105 + mile / 100,
    kind,
    owned_mi: 0,
    eta_utc: '2026-11-15T13:00:00Z',
    tz: 'America/Denver',
    status: level === null ? 'no_data' : 'ok',
    weather:
      level === null
        ? null
        : { wind_mph: 10, gust_mph: 15, rain_in_hr: 0, snow_in_hr: 0, cell: [40, -105] },
    level,
    score: level === null ? null : LEVEL_BYTE[level],
    levels: level === null ? null : { wind: level, rain: 'LOW', snow: 'LOW' },
    triggers: [],
  }
}

function route(id: string, lengthMi: number, levels: Array<RiskLevel | null>): PlanRoute {
  const marks = (interval: number) => {
    const miles: number[] = []
    for (let m = 0; m < lengthMi; m += interval) miles.push(m)
    miles.push(lengthMi)
    return miles.map((m, i) => checkpoint(m, lengthMi, levels[i % levels.length] ?? 'LOW'))
  }
  const interval = (mi: number) => ({
    checkpoints: marks(mi),
    aggregates: {
      miles_by_level: { LOW: lengthMi, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: 0, NO_DATA: 0 },
      avg_risk: 0,
      max_level: 'LOW' as const,
      checkpoint_count: marks(mi).length,
    },
  })
  return {
    id,
    label: `Route ${id}`,
    source: 'tomtom',
    summary: {
      distance_mi: lengthMi,
      duration_s: lengthMi * 60,
      driving_s: lengthMi * 60,
      hos_stop_s: 0,
      departure_utc: '2026-11-15T13:00:00Z',
      arrival_utc: '2026-11-15T21:00:00Z',
      traffic_delay_s: 0,
    },
    // A straight line east along 40°N, one vertex per 10 mi.
    geometry: {
      encoding: 'polyline6',
      value: encodePolyline6(
        Array.from(
          { length: lengthMi / 10 + 1 },
          (_, i) => [40, -105 + i / 10] as [number, number],
        ),
      ),
    },
    stops: [],
    intervals: { 10: interval(10), 25: interval(25), 50: interval(50) },
  }
}

function recommendation(routeId: string): Recommendation {
  return {
    route_id: routeId,
    ranking: [routeId, routeId === 'A' ? 'B' : 'A'],
    all_no_travel: false,
    steps: ['no_weather_data', 'no_travel_mi', 'severe_mi', 'high_mi', 'avg_risk', 'duration_min'],
    keys: { A: [0, 0, 0, 0, 0, 100], B: [0, 0, 0, 0, 0, 120] },
    decided_by: { B: 'duration_min' },
    decisive_step: 'duration_min',
  }
}

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function makePlan(): Plan {
  const hours = 49
  const count = 2
  const levels = new Uint8Array(hours * count).map((_, i) => (i % count === 0 ? 0 : i % 5))
  const u16 = b64(new Uint8Array(hours * count * 2))
  return {
    departure_utc: '2026-11-15T13:00:00Z',
    origin_tz: 'America/Denver',
    generated_at: '2026-11-14T12:00:00Z',
    load_weight_lb: 45000,
    apply_hos: false,
    routes: [route('A', 100, ['LOW', 'MODERATE', 'HIGH', null]), route('B', 120, ['LOW'])],
    recommendation: { 10: recommendation('A'), 25: recommendation('A'), 50: recommendation('A') },
    heatmap: {
      base_time_utc: '2026-11-15T13:00:00Z',
      hours,
      cell_deg: 0.2,
      count,
      lat: [40, 40.2],
      lon: [-105, -104.8],
      levels_b64: b64(levels),
      wind_mph_x10_b64: u16,
      rain_in_hr_x1000_b64: u16,
      snow_in_hr_x100_b64: u16,
    },
    warnings: [],
  }
}
