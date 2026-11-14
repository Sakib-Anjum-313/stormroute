/**
 * Shared E2E helpers: a `test` that fails on console errors, NDJSON plan parsing and map
 * projection through the scene's debug handle (`window.spotterScene`, see `features/map/scene.ts`).
 */
import { expect, test as base, type Page, type Response } from '@playwright/test'

declare global {
  interface Window {
    spotterScene?: {
      renders: number
      frameKey: number
      map: {
        loaded(): boolean
        isMoving(): boolean
        project(lngLat: [number, number]): { x: number; y: number }
        getCanvas(): HTMLCanvasElement
      }
    }
  }
}

/** The slice of the plan contract the specs read (see the api-contracts skill). */
export interface E2ECheckpoint {
  mile: number
  lat: number
  lon: number
  kind: 'origin' | 'interval' | 'destination'
  status: 'ok' | 'no_data'
  level: string
  triggers: { rule: string; detail: string }[]
}

export interface E2EPlan {
  routes: { id: string; intervals: Record<'10' | '25' | '50', { checkpoints: E2ECheckpoint[] }> }[]
  recommendation: Record<'10' | '25' | '50', { route_id: string; all_no_travel: boolean }>
  warnings: { code: string }[]
}

interface ConsoleGuard {
  /** Ignore console errors matching `pattern` in this test (e.g. Chrome's own network line). */
  allow: (pattern: RegExp) => void
}

/**
 * `test` with an automatic console guard: any console error or uncaught page error fails the test,
 * unless the test allowed it with `consoleGuard.allow`.
 */
export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: [
    async ({ page }, use) => {
      const allowed: RegExp[] = []
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
      })
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
      await use({ allow: (pattern) => allowed.push(pattern) })
      expect(errors.filter((line) => !allowed.some((re) => re.test(line)))).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Chrome logs every non-2xx response itself; the app logs nothing for an expected 422. */
export const CHROME_422_LINE = /Failed to load resource: the server responded with a status of 422/

export const isPlanPost = (response: Response) =>
  response.url().endsWith('/api/plan') && response.request().method() === 'POST'

/**
 * The plan of the next `/api/plan` submit. Chrome keeps no body for a streamed response, so the
 * request is passed through `route.fetch` and fulfilled with the same status, headers and body
 * (decompressed, so the encoding headers are dropped).
 */
export async function capturePlan(page: Page): Promise<() => Promise<E2EPlan>> {
  let resolve: (body: string) => void = () => {}
  const body = new Promise<string>((r) => (resolve = r))
  await page.route('**/api/plan', async (route) => {
    const response = await route.fetch()
    const text = await response.text()
    const headers = { ...response.headers() }
    delete headers['content-encoding']
    delete headers['content-length']
    await route.fulfill({ status: response.status(), headers, body: text })
    resolve(text)
  })
  return async () => {
    const lines = (await body).split('\n').filter((line) => line.trim() !== '')
    const events = lines.map((line) => JSON.parse(line) as { type: string; plan?: E2EPlan })
    const result = events.find((event) => event.type === 'result')
    if (!result?.plan) throw new Error(`no result event: ${events.map((e) => e.type).join(',')}`)
    return result.plan
  }
}

/** Wait until the basemap has loaded and the camera has stopped (after `fitBounds`). */
export async function waitForMapIdle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = window.spotterScene?.map
          return map ? map.loaded() && !map.isMoving() : false
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Page coordinates of a lon/lat on the map canvas. */
export function projectToPage(page: Page, lon: number, lat: number): Promise<[number, number]> {
  return page.evaluate(
    ([lo, la]) => {
      const map = window.spotterScene?.map
      if (!map) throw new Error('map not ready')
      const rect = map.getCanvas().getBoundingClientRect()
      const p = map.project([lo, la])
      return [rect.left + p.x, rect.top + p.y] as [number, number]
    },
    [lon, lat] as const,
  )
}

/** Requests that are not basemap tiles, fonts or sprites (OpenFreeMap). */
export const isAppRequest = (url: string) => !url.includes('tiles.openfreemap.org')
