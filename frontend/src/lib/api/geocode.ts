import { API_BASE_URL } from './client'
import { errorFromResponse, networkError } from './errors'
import type { GeocodeResult, GeocodeResponse } from './types'

/** The backend rejects shorter queries with 400, so the UI does not send them. */
export const GEOCODE_MIN_CHARS = 3

export async function fetchGeocode(
  query: string,
  signal?: AbortSignal,
  limit = 5,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/geocode?${params.toString()}`,
      signal ? { signal } : {},
    )
    if (!response.ok) throw await errorFromResponse(response)
    const body = (await response.json()) as GeocodeResponse
    return body.results
  } catch (error) {
    throw networkError(error)
  }
}
