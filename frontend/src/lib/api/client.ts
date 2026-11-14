/** Base URL of the Django API. Empty in dev: Vite proxies /api to :8000. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

export interface Health {
  status: string
  version: string
}

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch(`${API_BASE_URL}/api/healthz`, signal ? { signal } : {})
  if (!response.ok) throw new Error(`healthz failed: HTTP ${response.status}`)
  return (await response.json()) as Health
}
