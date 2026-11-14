/** Geometry helpers for drawing: polyline6 decoding, path mileage and path slicing. */

export const EARTH_RADIUS_M = 6_371_008.8
export const METERS_PER_MILE = 1609.344

/**
 * Decode a Google-style encoded polyline with 1e6 precision (TomTom/OSRM "polyline6").
 * Returns a flat `[lon0, lat0, lon1, lat1, ...]` array, the layout deck.gl's `PathLayer`
 * takes with `positionFormat: 'XY'`.
 */
export function decodePolyline6(encoded: string): Float64Array {
  const coords: number[] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    for (let field = 0; field < 2; field++) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        if (index >= encoded.length) throw new Error('truncated polyline')
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (field === 0) lat += delta
      else lon += delta
    }
    coords.push(lon / 1e6, lat / 1e6)
  }
  return Float64Array.from(coords)
}

const RAD = Math.PI / 180

/** Typed-array read for indices the caller has bounds-checked. */
function at(array: Float64Array, index: number): number {
  return array[index] as number
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Cumulative mileage at every vertex of a flat XY path, scaled so the last value equals
 * `totalMi` (the route's reported length), the same normalization the backend uses for
 * checkpoint miles. Without a total the raw haversine length is kept.
 */
export function cumulativeMiles(path: Float64Array, totalMi?: number): Float64Array {
  const n = path.length / 2
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const d = haversineM(
      at(path, i * 2 - 1),
      at(path, i * 2 - 2),
      at(path, i * 2 + 1),
      at(path, i * 2),
    )
    cum[i] = at(cum, i - 1) + d / METERS_PER_MILE
  }
  const raw = n > 0 ? at(cum, n - 1) : 0
  if (totalMi !== undefined && raw > 0) {
    const k = totalMi / raw
    for (let i = 0; i < n; i++) cum[i] = at(cum, i) * k
  }
  return cum
}

/** Index of the last vertex with `cum[i] <= mile` (binary search). */
function vertexAtOrBefore(cum: Float64Array, mile: number): number {
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (at(cum, mid) <= mile) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Position on the path at `mile`, linearly interpolated within its segment, written into
 * `out[0..1]`. Allocation-free: the truck ghosts call it on every slider frame.
 */
export function pointAtMileInto(
  path: Float64Array,
  cum: Float64Array,
  mile: number,
  out: [number, number],
): void {
  const last = cum.length - 1
  if (last < 0) {
    out[0] = Number.NaN
    out[1] = Number.NaN
    return
  }
  if (mile <= 0 || last === 0) {
    out[0] = at(path, 0)
    out[1] = at(path, 1)
    return
  }
  if (mile >= at(cum, last)) {
    out[0] = at(path, last * 2)
    out[1] = at(path, last * 2 + 1)
    return
  }
  const i = vertexAtOrBefore(cum, mile)
  const seg = at(cum, i + 1) - at(cum, i)
  const f = seg > 0 ? (mile - at(cum, i)) / seg : 0
  out[0] = at(path, i * 2) + (at(path, i * 2 + 2) - at(path, i * 2)) * f
  out[1] = at(path, i * 2 + 1) + (at(path, i * 2 + 3) - at(path, i * 2 + 1)) * f
}

/** Position on the path at `mile`, linearly interpolated within its segment. */
export function pointAtMile(path: Float64Array, cum: Float64Array, mile: number): [number, number] {
  const out: [number, number] = [0, 0]
  pointAtMileInto(path, cum, mile, out)
  return out
}

/**
 * The part of a flat XY path between two mileages, with interpolated end points, as a new flat
 * array. Used once per plan to cut a route into the segments its checkpoints own.
 */
export function slicePath(
  path: Float64Array,
  cum: Float64Array,
  fromMi: number,
  toMi: number,
): Float64Array {
  const start = pointAtMile(path, cum, fromMi)
  const end = pointAtMile(path, cum, toMi)
  const out: number[] = [start[0], start[1]]
  if (cum.length > 1 && toMi > fromMi) {
    const first = vertexAtOrBefore(cum, fromMi) + 1
    for (let i = first; i < cum.length && at(cum, i) < toMi; i++) {
      out.push(at(path, i * 2), at(path, i * 2 + 1))
    }
  }
  out.push(end[0], end[1])
  return Float64Array.from(out)
}

export interface Bounds {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export function pathBounds(paths: readonly Float64Array[]): Bounds | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const path of paths) {
    for (let i = 0; i < path.length; i += 2) {
      const lon = at(path, i)
      const lat = at(path, i + 1)
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  return Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null
}
