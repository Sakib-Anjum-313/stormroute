import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { setHour, usePlanStore } from '../../store/planStore'
import { formatSliderTime, keyboardHour, makeSliderFormatter, MAX_HOUR } from './sliderTime'

/** Playback speed in slider hours per wall-clock second. */
const PLAY_HOURS_PER_S = 3

/**
 * 0-48 h slider over the heatmap frames. It stays out of React's render path while scrubbing:
 * the input is uncontrolled, input events are coalesced to one store write per animation frame,
 * and the time label is written to the DOM from a store subscription (map-performance rule 3-4).
 */
export function TimeSlider() {
  const baseUtcS = usePlanStore((s) => s.plan?.heatmap.baseTimeUtcS ?? null)
  const originTz = usePlanStore((s) => s.originTz)
  const inputRef = useRef<HTMLInputElement>(null)
  const labelRef = useRef<HTMLOutputElement>(null)
  const pending = useRef<{ frame: number; value: number }>({ frame: 0, value: 0 })
  const [playing, setPlaying] = useState(false)

  // Mirror the store's hour into the input and label without re-rendering.
  useEffect(() => {
    if (baseUtcS === null) return
    const formatter = makeSliderFormatter(originTz)
    const paint = (hour: number) => {
      const text = formatSliderTime(formatter, baseUtcS, hour)
      if (labelRef.current) labelRef.current.textContent = text
      const input = inputRef.current
      if (input) {
        if (Math.abs(input.valueAsNumber - hour) > 1e-9) input.value = String(hour)
        input.setAttribute('aria-valuetext', text)
      }
    }
    paint(usePlanStore.getState().hour)
    return usePlanStore.subscribe((state, prev) => {
      if (state.hour !== prev.hour) paint(state.hour)
    })
  }, [baseUtcS, originTz])

  useEffect(() => {
    const p = pending.current
    return () => cancelAnimationFrame(p.frame)
  }, [])

  // Playback: advance the hour every frame, stop at the end.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      const hour = usePlanStore.getState().hour + ((now - last) / 1000) * PLAY_HOURS_PER_S
      last = now
      setHour(hour)
      if (hour >= MAX_HOUR) setPlaying(false)
      else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  if (baseUtcS === null) return null

  const writeCoalesced = (value: number) => {
    const p = pending.current
    p.value = value
    if (p.frame === 0) {
      p.frame = requestAnimationFrame(() => {
        p.frame = 0
        setHour(p.value)
      })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const next = keyboardHour(event.key, usePlanStore.getState().hour)
    if (next === null) return
    event.preventDefault()
    setPlaying(false)
    setHour(next)
  }

  const togglePlay = () => {
    if (!playing && usePlanStore.getState().hour >= MAX_HOUR) setHour(0)
    setPlaying((p) => !p)
  }

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause heatmap' : 'Play heatmap'}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
      >
        <span aria-hidden>{playing ? '❚❚' : '▶'}</span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-xs text-ink-2">
          <span className="font-medium text-ink">
            Weather<span className="max-sm:hidden"> along the corridor</span>
          </span>
          <output ref={labelRef} htmlFor="heatmap-hour" className="tabular-nums" />
        </div>
        <input
          ref={inputRef}
          id="heatmap-hour"
          type="range"
          min={0}
          max={MAX_HOUR}
          step="any"
          defaultValue={0}
          aria-label="Hours after departure"
          onInput={(event) => writeCoalesced(event.currentTarget.valueAsNumber)}
          onPointerDown={() => setPlaying(false)}
          onKeyDown={onKeyDown}
          className="w-full accent-[var(--accent)]"
          data-testid="heatmap-slider"
        />
        <div className="flex justify-between text-[10px] text-ink-3" aria-hidden>
          <span>0 h</span>
          <span>12 h</span>
          <span>24 h</span>
          <span>36 h</span>
          <span>48 h</span>
        </div>
      </div>
    </div>
  )
}
