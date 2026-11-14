/**
 * Is the API awake? The free Render web service sleeps after idling, and the first request can
 * take ~30 s. On load we probe /api/healthz: if it has not answered within 2 s the UI says the
 * server is waking up and holds the submit buttons until it answers (PLAN section 7, Cold API).
 */
import { create } from 'zustand'

import { fetchHealth } from '../lib/api/client'

export type ApiStatus = 'checking' | 'waking' | 'ready' | 'unreachable'

export const useApiStatus = create<{ status: ApiStatus }>(() => ({ status: 'checking' }))

export const WAKE_NOTICE_MS = 2_000
export const PROBE_TIMEOUT_MS = 10_000
export const RETRY_MS = 2_000
export const GIVE_UP_MS = 90_000

export interface HealthDeps {
  probe: (signal: AbortSignal) => Promise<unknown>
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const defaultDeps: HealthDeps = {
  probe: (signal) => fetchHealth(signal),
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
}

const set = (status: ApiStatus) => {
  if (useApiStatus.getState().status !== status) useApiStatus.setState({ status })
}

/** Probe until the API answers or `GIVE_UP_MS` passes. Returns a cancel function. */
export function watchApiHealth(deps: HealthDeps = defaultDeps): () => void {
  const started = deps.now()
  let cancelled = false
  let retry: unknown = null
  set('checking')
  const notice = deps.setTimer(() => {
    if (!cancelled && useApiStatus.getState().status === 'checking') set('waking')
  }, WAKE_NOTICE_MS)

  const attempt = () => {
    const controller = new AbortController()
    const timeout = deps.setTimer(() => controller.abort(), PROBE_TIMEOUT_MS)
    deps.probe(controller.signal).then(
      () => {
        deps.clearTimer(timeout)
        if (cancelled) return
        deps.clearTimer(notice)
        set('ready')
      },
      () => {
        deps.clearTimer(timeout)
        if (cancelled) return
        if (deps.now() - started >= GIVE_UP_MS) {
          deps.clearTimer(notice)
          set('unreachable')
          return
        }
        set('waking')
        retry = deps.setTimer(attempt, RETRY_MS)
      },
    )
  }
  attempt()

  return () => {
    cancelled = true
    deps.clearTimer(notice)
    if (retry !== null) deps.clearTimer(retry)
  }
}
