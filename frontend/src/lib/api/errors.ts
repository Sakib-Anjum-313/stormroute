import type { ErrorBody, ErrorCode } from './types'

/** Any failure of an API call, carrying the contract's error body. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown>
  readonly retryAfterS: number | null
  readonly status: number | null

  constructor(body: ErrorBody, status: number | null = null) {
    super(body.message)
    this.name = 'ApiError'
    this.code = body.code
    this.details = body.details
    this.retryAfterS = body.retry_after_s
    this.status = status
  }

  static of(code: ErrorCode, message: string, status: number | null = null): ApiError {
    return new ApiError({ code, message, details: {}, retry_after_s: null }, status)
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return typeof body.code === 'string' && typeof body.message === 'string'
}

/** Build an `ApiError` from a non-2xx response. Error bodies are JSON; anything else is generic. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  try {
    const json = (await response.json()) as { error?: unknown }
    if (isErrorBody(json.error)) {
      return new ApiError(
        {
          ...json.error,
          details: json.error.details ?? {},
          retry_after_s: json.error.retry_after_s ?? null,
        },
        response.status,
      )
    }
  } catch {
    // Not JSON (a proxy error page, for example): fall through to the generic error.
  }
  const code: ErrorCode = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE'
  return ApiError.of(code, `The server returned HTTP ${response.status}.`, response.status)
}

/** Map a thrown `fetch` failure (offline, DNS, CORS) to an `ApiError`; abort errors pass through. */
export function networkError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === 'AbortError') return error
  if (error instanceof ApiError) return error
  return ApiError.of('UPSTREAM_UNAVAILABLE', 'Cannot reach the server. Check your connection.')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export { isErrorBody }
