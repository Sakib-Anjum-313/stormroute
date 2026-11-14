/**
 * Heatmap slider smoothness (map-performance skill, "Measuring"; PLAN section 8).
 *
 * Loads the fixture demo plan, then scrubs the 0-48 h slider (keyboard steps plus a fractional
 * pointer drag, which exercises the crossfade) twice: unthrottled and at 4x CPU throttling. For
 * each phase it records rAF frame times, long tasks and network requests, and writes a JSON
 * summary to `e2e/perf/last-run.json`.
 *
 * Targets: frame p95 <= 16.7 ms unthrottled and <= 33 ms at 4x, 0 long tasks > 50 ms, 0 requests.
 *
 * "16.7 ms" is one 60 Hz vsync interval (16.67 ms). rAF timestamps of consecutive vsynced frames
 * jitter by a few tenths of a millisecond (a perfect run reads 16.6-16.8), so the frame budget is
 * one interval plus `VSYNC_JITTER_MS`, and every frame over 1.5 intervals counts as dropped.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    perf: {
      recording: boolean
      frames: number[]
      longTasks: number[]
    }
    spotterScene?: { renders: number; frameKey: number; map: { loaded(): boolean } }
  }
}

const SCRUB_MS = 10_000
const VSYNC_MS = 1000 / 60
const VSYNC_JITTER_MS = 0.5
const FRAME_BUDGET_MS = { unthrottled: VSYNC_MS + VSYNC_JITTER_MS, throttled4x: 33 }
const KEYBOARD_MS = 3_000

/** rAF frame-time sampler and long-task observer, installed before any app code runs. */
function installSampler() {
  window.perf = { recording: false, frames: [], longTasks: [] }
  let last = performance.now()
  const loop = (now: number) => {
    if (window.perf.recording) window.perf.frames.push(now - last)
    last = now
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  new PerformanceObserver((list) => {
    if (!window.perf.recording) return
    for (const entry of list.getEntries()) window.perf.longTasks.push(entry.duration)
  }).observe({ type: 'longtask', buffered: false })
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? Number.NaN
}

const round = (n: number) => Math.round(n * 100) / 100

async function scrub(page: Page) {
  const slider = page.getByTestId('heatmap-slider')
  const box = await slider.boundingBox()
  if (!box) throw new Error('slider not visible')

  // Keyboard: whole-hour steps up and back.
  await slider.focus()
  const keyboardEnd = Date.now() + KEYBOARD_MS
  let key: 'ArrowRight' | 'ArrowLeft' = 'ArrowRight'
  let steps = 0
  while (Date.now() < keyboardEnd) {
    await page.keyboard.press(key)
    steps++
    if (steps % 48 === 0) key = key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight'
    await page.waitForTimeout(16)
  }

  // Pointer drag: fractional hours, so every frame crossfades two heatmap frames.
  const y = box.y + box.height / 2
  const left = box.x + 4
  const right = box.x + box.width - 4
  await page.mouse.move(left, y)
  await page.mouse.down()
  const dragEnd = Date.now() + (SCRUB_MS - KEYBOARD_MS)
  let forward = true
  while (Date.now() < dragEnd) {
    for (let i = 1; i <= 90 && Date.now() < dragEnd; i++) {
      const f = forward ? i / 90 : 1 - i / 90
      await page.mouse.move(left + (right - left) * f, y)
    }
    forward = !forward
  }
  await page.mouse.up()
}

interface PhaseResult {
  cpuThrottle: number
  durationMs: number
  frames: number
  frameP50Ms: number
  frameP95Ms: number
  frameMaxMs: number
  droppedFrames: number
  longTasksOver50Ms: number
  longestTaskMs: number
  requests: string[]
  sceneRenders: number
  heatmapFrames: number
}

async function measurePhase(page: Page, cpuThrottle: number): Promise<PhaseResult> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
  const requests: string[] = []
  const onRequest = (request: { url(): string }) => requests.push(request.url())
  page.on('request', onRequest)

  const before = await page.evaluate(() => ({
    renders: window.spotterScene?.renders ?? 0,
    frameKey: window.spotterScene?.frameKey ?? 0,
  }))
  await page.evaluate(() => {
    window.perf.frames = []
    window.perf.longTasks = []
    window.perf.recording = true
  })
  const started = Date.now()
  await scrub(page)
  const durationMs = Date.now() - started
  const sample = await page.evaluate(() => {
    window.perf.recording = false
    return {
      frames: window.perf.frames,
      longTasks: window.perf.longTasks,
      renders: window.spotterScene?.renders ?? 0,
      frameKey: window.spotterScene?.frameKey ?? 0,
    }
  })

  page.off('request', onRequest)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()

  return {
    cpuThrottle,
    durationMs,
    frames: sample.frames.length,
    frameP50Ms: round(percentile(sample.frames, 50)),
    frameP95Ms: round(percentile(sample.frames, 95)),
    frameMaxMs: round(Math.max(...sample.frames)),
    droppedFrames: sample.frames.filter((ms) => ms > VSYNC_MS * 1.5).length,
    longTasksOver50Ms: sample.longTasks.filter((d) => d > 50).length,
    longestTaskMs: round(Math.max(0, ...sample.longTasks)),
    requests,
    sceneRenders: sample.renders - before.renders,
    heatmapFrames: sample.frameKey - before.frameKey,
  }
}

test('heatmap slider scrubs smoothly with no network', async ({ page, browserName }) => {
  await page.addInitScript(installSampler)
  await page.goto('/?fixture=default')
  await page.getByRole('button', { name: 'Try demo trip' }).click()
  await expect(page.getByTestId('plan-summary')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('heatmap-slider')).toBeVisible()
  // Let the basemap finish loading tiles so the scrub measures only our work.
  await expect
    .poll(() => page.evaluate(() => window.spotterScene?.map.loaded() ?? false), {
      timeout: 30_000,
    })
    .toBe(true)
  await page.waitForLoadState('networkidle')

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  })

  const unthrottled = await measurePhase(page, 1)
  const throttled = await measurePhase(page, 4)

  const summary = {
    ranAt: new Date().toISOString(),
    browser: `${browserName} (${test.info().project.use.channel ?? 'bundled'})`,
    gpu,
    targets: {
      frameP95MsUnthrottled: round(FRAME_BUDGET_MS.unthrottled),
      frameP95MsThrottled4x: FRAME_BUDGET_MS.throttled4x,
      droppedFramesUnthrottled: 0,
      longTasksOver50Ms: 0,
      requests: 0,
    },
    unthrottled,
    throttled4x: throttled,
  }
  const out = fileURLToPath(new URL('./last-run.json', import.meta.url))
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

  expect(unthrottled.requests).toEqual([])
  expect(throttled.requests).toEqual([])
  expect(unthrottled.longTasksOver50Ms).toBe(0)
  expect(throttled.longTasksOver50Ms).toBe(0)
  expect(unthrottled.frameP95Ms).toBeLessThanOrEqual(FRAME_BUDGET_MS.unthrottled)
  expect(unthrottled.droppedFrames).toBe(0)
  expect(throttled.frameP95Ms).toBeLessThanOrEqual(FRAME_BUDGET_MS.throttled4x)
  // The scrub really drove the heatmap.
  expect(unthrottled.heatmapFrames).toBeGreaterThan(100)
})
