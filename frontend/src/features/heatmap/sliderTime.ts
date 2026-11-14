export const MAX_HOUR = 48

/** "Sat 06:00 MST · +5 h" for `hour` hours after `baseUtcS`, in the origin's time zone. */
export function formatSliderTime(
  formatter: Intl.DateTimeFormat,
  baseUtcS: number,
  hour: number,
): string {
  const time = formatter.format(new Date((baseUtcS + hour * 3600) * 1000))
  const offset = hour < 0.05 ? 'departure' : `+${hour < 10 ? hour.toFixed(1) : Math.round(hour)} h`
  return `${time} · ${offset}`
}

export function makeSliderFormatter(timeZone: string | null): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat('en-US', timeZone ? { ...options, timeZone } : options)
  } catch {
    // Unknown zone name: fall back to the browser's zone rather than failing the slider.
    return new Intl.DateTimeFormat('en-US', options)
  }
}

/** Keyboard steps are whole hours; dragging stays fractional so the heatmap crossfades. */
export function keyboardHour(key: string, hour: number): number | null {
  const up = (n: number) => Math.min(MAX_HOUR, Math.floor(hour + 1e-6) + n)
  const down = (n: number) => Math.max(0, Math.ceil(hour - 1e-6) - n)
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return up(1)
    case 'ArrowLeft':
    case 'ArrowDown':
      return down(1)
    case 'PageUp':
      return up(6)
    case 'PageDown':
      return down(6)
    case 'Home':
      return 0
    case 'End':
      return MAX_HOUR
    default:
      return null
  }
}
