import { API_BASE_URL } from './client'
import { ApiError, errorFromResponse, isErrorBody, networkError } from './errors'
import type { FixtureScenario, Plan, PlanRequest, PlanStreamEvent } from './types'

/**
 * Split a byte stream into newline-delimited JSON values.
 *
 * Network chunks are arbitrary: one chunk can hold several lines, a line can span chunks, and a
 * chunk can end in the middle of a multi-byte UTF-8 character (`TextDecoder` with `stream: true`
 * keeps the partial bytes). Blank lines are skipped, and a last line without a trailing newline is
 * still parsed.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield parseLine(line)
        newline = buffer.indexOf('\n')
      }
      if (done) break
    }
    const rest = buffer.trim()
    if (rest) yield parseLine(rest)
  } finally {
    // Runs on normal completion, on a thrown error and when the consumer stops early.
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    throw ApiError.of('UPSTREAM_UNAVAILABLE', 'The server sent a malformed response.')
  }
}

const EVENT_TYPES = new Set(['meta', 'routes', 'progress', 'result', 'error'])

/** Runtime guard for one stream line. The shape behind `type` is trusted to match the schema. */
export function isPlanStreamEvent(value: unknown): value is PlanStreamEvent {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && EVENT_TYPES.has(type)
}

export interface StreamPlanOptions {
  signal?: AbortSignal
  fixture?: FixtureScenario | null
  onEvent?: (event: PlanStreamEvent) => void
}

/**
 * POST /api/plan in NDJSON mode and resolve with the final plan.
 *
 * - Routing and validation failures happen before the first line, so they arrive as a normal HTTP
 *   error with a JSON body: `response.ok` is checked first.
 * - An in-stream `error` event rejects with that error.
 * - A stream that ends without `result` or `error` rejects with `UPSTREAM_UNAVAILABLE`.
 * - Aborting the signal rejects with the `AbortError` from `fetch`.
 */
export async function streamPlan(
  request: PlanRequest,
  options: StreamPlanOptions = {},
): Promise<Plan> {
  const headers: Record<string, string> = {
    Accept: 'application/x-ndjson',
    'Content-Type': 'application/json',
  }
  if (options.fixture) headers['X-Fixture'] = options.fixture

  try {
    const response = await fetch(`${API_BASE_URL}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!response.ok) throw await errorFromResponse(response)
    if (!response.body) throw ApiError.of('UPSTREAM_UNAVAILABLE', 'The server sent no data.')

    for await (const value of readNdjson(response.body)) {
      if (!isPlanStreamEvent(value)) continue
      options.onEvent?.(value)
      if (value.type === 'result') return value.plan
      if (value.type === 'error') {
        if (isErrorBody(value.error)) throw new ApiError(value.error, response.status)
        throw ApiError.of('UPSTREAM_UNAVAILABLE', 'The plan failed.')
      }
    }
    throw ApiError.of('UPSTREAM_UNAVAILABLE', 'The connection closed before the plan finished.')
  } catch (error) {
    throw networkError(error)
  }
}
