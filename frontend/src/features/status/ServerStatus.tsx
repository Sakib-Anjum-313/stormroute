import { useApiStatus } from '../../store/apiStatus'
import { Banner } from '../../ui/Banner'

/** Cold-start notice for the free API host, driven by the healthz probe. */
export function ServerStatus() {
  const status = useApiStatus((s) => s.status)
  if (status === 'waking') {
    return (
      <Banner
        tone="info"
        live="polite"
        title="Waking the server…"
        testId="server-waking"
        icon={
          <span
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        }
      >
        Free hosting sleeps when idle; this takes about 30 s. Planning unlocks when it answers.
      </Banner>
    )
  }
  if (status === 'unreachable') {
    return (
      <Banner tone="danger" live="assertive" title="Can't reach the server">
        Planning may fail. Check your connection or try again in a minute.
      </Banner>
    )
  }
  return null
}
