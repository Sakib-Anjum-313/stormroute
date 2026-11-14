/** Display formatting shared by the cards, the Why panel and the map popups. */

export function formatMiles(mi: number): string {
  return `${mi.toFixed(1)} mi`
}

/** "7 h 33 min", "45 min", "0 min"; rounds to the minute. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Average risk on the 0-4 scale, or an em dash when the route has no weather data. */
export function formatAvgRisk(avg: number | null): string {
  return avg === null ? '—' : avg.toFixed(2)
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Cached "Sat 13:33 MST" formatter for an IANA zone; unknown zones fall back to the browser's. */
export function timeFormatter(timeZone: string | null): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  const cached = formatters.get(key)
  if (cached) return cached
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', timeZone ? { ...options, timeZone } : options)
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', options)
  }
  formatters.set(key, formatter)
  return formatter
}

/** "Sat 13:33 MST" for an instant (ISO string or epoch ms) in `timeZone`. */
export function formatTime(instant: string | number, timeZone: string | null): string {
  return timeFormatter(timeZone).format(new Date(instant)).replace(', ', ' ')
}

/** "45,000 lb" */
export function formatPounds(lb: number): string {
  return `${Math.round(lb).toLocaleString('en-US')} lb`
}

/** Weather values as the backend rounded them (0.1 mph, 0.001 in/hr); `null` shows a dash. */
export function formatMph(mph: number | null): string {
  return mph === null ? '—' : `${mph.toFixed(1)} mph`
}

export function formatInHr(inHr: number | null): string {
  return inHr === null ? '—' : `${inHr.toFixed(inHr === 0 ? 0 : 3)} in/hr`
}
