import { ApiError } from './errors'
import { readNdjson, streamPlan } from './ndjson'
import type { Plan, PlanRequest, PlanStreamEvent } from './types'

const encoder = new TextEncoder()

/** A body stream that delivers exactly these byte chunks. */
function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const value of readNdjson(stream)) out.push(value)
  return out
}

/** Split `text` into byte chunks at every given byte offset. */
function splitBytes(text: string, offsets: number[]): Uint8Array[] {
  const bytes = encoder.encode(text)
  const cuts = [0, ...offsets, bytes.length]
  return cuts.slice(1).map((end, i) => bytes.slice(cuts[i], end))
}

describe('readNdjson', () => {
  const lines = [{ type: 'meta', a: 1 }, { type: 'progress', done: 2 }, { label: 'Zürich → Köln' }]
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'

  test.each([
    ['one chunk', [text]],
    ['one chunk per line', text.split(/(?<=\n)/)],
    ['a line split mid-object', [text.slice(0, 7), text.slice(7)]],
    [
      'a split right before the newline',
      [text.slice(0, text.indexOf('\n')), text.slice(text.indexOf('\n'))],
    ],
    ['one character per chunk', [...text]],
  ])('parses %s', async (_name, chunks) => {
    expect(await collect(streamOf(chunks))).toEqual(lines)
  })

  test('reassembles a multi-byte character split across chunks', async () => {
    const arrow = encoder.encode(text).indexOf(0xe2) // first byte of "→"
    const chunks = splitBytes(text, [arrow + 1, arrow + 2])
    expect(await collect(streamOf(chunks))).toEqual(lines)
  })

  test('parses a final line without a trailing newline and skips blank lines', async () => {
    expect(await collect(streamOf(['{"a":1}\n\n', '  \n{"b":', '2}']))).toEqual([
      { a: 1 },
      { b: 2 },
    ])
  })

  test('a malformed line fails as UPSTREAM_UNAVAILABLE', async () => {
    await expect(collect(streamOf(['{"a":1}\n{oops\n']))).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    })
  })
})

const request: PlanRequest = {
  origin: { label: 'Denver', lat: 39.74, lon: -104.99 },
  destination: { label: 'Salt Lake City', lat: 40.76, lon: -111.89 },
  departure_local: '2026-11-15T06:00',
  load_weight_lb: 45000,
  apply_hos: false,
}

const plan = { routes: [], warnings: [] } as unknown as Plan
const meta: PlanStreamEvent = {
  type: 'meta',
  departure_utc: '2026-11-15T13:00:00Z',
  origin_tz: 'America/Denver',
}
const progress: PlanStreamEvent = { type: 'progress', stage: 'weather', done: 1, total: 2 }
const result: PlanStreamEvent = { type: 'result', plan }

function ndjsonResponse(events: unknown[], chunkSize = 13): Response {
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize))
  return new Response(streamOf(chunks), {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

describe('streamPlan', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(response: Response) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(response),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  test('sends NDJSON accept and the fixture header, emits every event, resolves with the plan', async () => {
    const fetchMock = stubFetch(ndjsonResponse([meta, progress, result]))
    const seen: string[] = []
    const out = await streamPlan(request, {
      fixture: 'two_routes',
      onEvent: (e) => seen.push(e.type),
    })
    expect(out).toEqual(plan)
    expect(seen).toEqual(['meta', 'progress', 'result'])
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Accept: 'application/x-ndjson',
      'X-Fixture': 'two_routes',
    })
    expect(JSON.parse(String(init?.body))).toEqual(request)
  })

  test('a non-2xx response rejects with its JSON error body before reading a stream', async () => {
    stubFetch(
      Response.json(
        {
          error: {
            code: 'NO_ROUTE',
            message: 'No truck route between these points.',
            details: {},
            retry_after_s: null,
          },
        },
        { status: 422 },
      ),
    )
    const error = await streamPlan(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'NO_ROUTE', status: 422 })
  })

  test('a non-JSON error page maps to a generic error by status', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(streamPlan(request)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })

  test('an in-stream error event rejects with that error', async () => {
    stubFetch(
      ndjsonResponse([
        meta,
        {
          type: 'error',
          error: {
            code: 'UPSTREAM_RATE_LIMITED',
            message: 'Weather busy',
            details: {},
            retry_after_s: 30,
          },
        },
      ]),
    )
    await expect(streamPlan(request)).rejects.toMatchObject({
      code: 'UPSTREAM_RATE_LIMITED',
      retryAfterS: 30,
    })
  })

  test('a stream that ends without result or error is UPSTREAM_UNAVAILABLE', async () => {
    stubFetch(ndjsonResponse([meta, progress]))
    await expect(streamPlan(request)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })

  test('a network failure is UPSTREAM_UNAVAILABLE, an abort passes through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await expect(streamPlan(request)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))),
    )
    await expect(streamPlan(request)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
