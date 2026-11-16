import { useEffect, useState } from 'react'

import type { ApiError } from '../../lib/api/errors'
import { retryPlan } from '../trip-form/runPlan'
import { formLevelMessages } from '../trip-form/schema'

const COPY: Record<ApiError['code'], { title: string; body: string | null }> = {
  VALIDATION: { title: 'Check the trip details', body: null },
  NO_ROUTE: {
    title: 'No truck route',
    body: 'No truck-legal route found between these places. Try a nearby city or address.',
  },
  RATE_LIMITED: {
    title: 'Too many plans',
    body: 'You can plan up to 10 trips a minute. Wait a moment and retry.',
  },
  UPSTREAM_RATE_LIMITED: {
    title: 'Service busy',
    body: 'The routing or weather service is rate-limiting requests.',
  },
  UPSTREAM_TIMEOUT: {
    title: 'Timed out',
    body: 'The routing or weather service did not answer in time.',
  },
  UPSTREAM_UNAVAILABLE: { title: 'Service unavailable', body: null },
  INTERNAL: { title: 'Something went wrong', body: 'An unexpected error on our side.' },
}

function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(seconds ?? 0)
  useEffect(() => {
    if (!seconds) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))
      setLeft(remaining)
      if (remaining === 0) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [seconds])
  return left
}

/** Code-specific error with Retry; a `retry_after_s` hint counts down on the button. */
export function ErrorCard({ error }: { error: ApiError }) {
  const left = useCountdown(error.retryAfterS)
  const validation = error.code === 'VALIDATION'
  // Field errors are shown inline on the form; only form-level ones need a card.
  const formMessages = validation ? formLevelMessages(error.details) : null
  if (validation && formMessages === null) return null
  const copy = COPY[error.code]
  const body = formMessages?.length ? formMessages.join(' ') : (copy.body ?? error.message)
  const requestId = typeof error.details.request_id === 'string' ? error.details.request_id : null
  return (
    <div
      role="alert"
      data-testid={`error-${error.code}`}
      className="animate-fade rounded-xl border border-red-300 bg-red-50 p-3.5 text-sm text-red-950 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100"
    >
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-0.5 text-[13px]">{body}</p>
      {requestId && <p className="mt-1 text-xs opacity-80">Reference {requestId}</p>}
      {/* Resending the same invalid trip cannot help: the trip has to change. */}
      {!validation && (
        <button
          type="button"
          onClick={() => void retryPlan()}
          disabled={left > 0}
          className="mt-2.5 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900"
        >
          {left > 0 ? `Retry in ${left} s` : 'Retry'}
        </button>
      )}
    </div>
  )
}
