// The WAI-ARIA combobox pattern needs role=listbox/option: <datalist> cannot show async results
// with an active option, so this file opts out of prefer-tag-over-role.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'

import { fetchGeocode, GEOCODE_MIN_CHARS } from '../../lib/api/geocode'
import type { GeocodeResult, Place } from '../../lib/api/types'
import { ERROR, FIELD, LABEL } from '../../ui/fieldStyles'

const DEBOUNCE_MS = 250

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export interface PlaceComboboxProps {
  label: string
  name: string
  value: Place | null
  onChange: (place: Place | null) => void
  error?: string | undefined
  placeholder?: string
}

/**
 * Autocomplete backed by GET /api/geocode (WAI-ARIA combobox with a listbox popup). Typing clears
 * the picked place, so the form can only submit coordinates the user chose from the list.
 */
export function PlaceCombobox({
  label,
  name,
  value,
  onChange,
  error,
  placeholder,
}: PlaceComboboxProps) {
  const id = useId()
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const errorId = `${id}-error`
  const [text, setText] = useState(value?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  // Keep the text in sync when the parent sets the place (the demo-trip button).
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    if (value) setText(value.label)
  }

  const query = useDebounced(text.trim(), DEBOUNCE_MS)
  const enabled = open && value === null && query.length >= GEOCODE_MIN_CHARS
  const results = useQuery({
    queryKey: ['geocode', query],
    queryFn: ({ signal }) => fetchGeocode(query, signal),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
  const options: GeocodeResult[] = enabled ? (results.data ?? []) : []
  const showList = enabled && options.length > 0
  // While the user is still typing (debounce pending) or the new query is in flight, the list
  // shows the previous query's matches: dim it and don't let Enter pick from it.
  const typing = text.trim() !== query
  const stale = typing || results.isPlaceholderData
  const searching =
    open &&
    value === null &&
    text.trim().length >= GEOCODE_MIN_CHARS &&
    (typing || results.isFetching)
  // The first match is highlighted by default, so Enter takes the top suggestion.
  const highlighted = showList ? Math.min(Math.max(active, 0), options.length - 1) : -1

  function pick(option: GeocodeResult) {
    onChange({ label: option.label, lat: option.lat, lon: option.lon })
    setText(option.label)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (options.length ? (Math.max(i, 0) + 1) % options.length : -1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1))
    } else if (event.key === 'Enter') {
      if (!showList) return
      // Never submit the form from a suggestion field while suggestions are open.
      event.preventDefault()
      const option = options[highlighted]
      if (!stale && option) pick(option)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const status: { text: string; visible: boolean } | null = searching
    ? { text: 'Searching…', visible: false }
    : !enabled
      ? null
      : results.isError
        ? { text: 'Place search is unavailable. Try again.', visible: true }
        : options.length === 0
          ? { text: `No matches for '${query}'`, visible: true }
          : null

  return (
    <div className="relative">
      <label htmlFor={inputId} className={LABEL}>
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
          setActive(-1)
          if (value) onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={`${FIELD} pr-9 pl-3`}
      />
      {searching && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-[2.45rem] right-3 size-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
        />
      )}
      {value && (
        <span
          className="pointer-events-none absolute top-[2.35rem] right-2.5 flex size-5 animate-[spin-in_300ms_ease-out] items-center justify-center rounded-full bg-accent-soft text-accent"
          aria-hidden
        >
          <svg viewBox="0 0 12 12" className="size-3">
            <path d="M2.5 6.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList}
        aria-busy={stale || undefined}
        className={`animate-fade absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-line-strong bg-popover p-1 text-sm shadow-[0_20px_50px_-12px_rgb(0_0_0/0.45),0_0_0_1px_var(--glass-edge)] transition-opacity duration-150 ${stale ? 'opacity-60' : ''}`}
      >
        {options.map((option, i) => (
          <div
            key={`${option.label}-${option.lat}-${option.lon}`}
            id={`${listId}-${i}`}
            role="option"
            // The label is split over two lines; keep the full text as the option's name.
            aria-label={option.label}
            tabIndex={-1}
            aria-selected={i === highlighted}
            // Pick on mousedown so the input's blur does not close the list first.
            onMouseDown={(event) => {
              event.preventDefault()
              pick(option)
            }}
            onMouseMove={() => {
              if (i !== highlighted) setActive(i)
            }}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-ink-2 aria-selected:bg-accent/15 aria-selected:text-ink"
          >
            <PlaceIcon kind={option.kind} />
            <PlaceLabel label={option.label} />
          </div>
        ))}
      </div>
      {open && status && (
        <output className={status.visible ? 'mt-1 block text-xs text-ink-3' : 'sr-only'}>
          {status.text}
        </output>
      )}
      {error && (
        <p id={errorId} className={ERROR}>
          {error}
        </p>
      )}
    </div>
  )
}

/** City or region pin for places; a house for street addresses. */
function PlaceIcon({ kind }: { kind: GeocodeResult['kind'] }) {
  const address = kind === 'PAD' || kind === 'Addr' || kind === 'Str'
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3"
    >
      {address ? (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
          <path d="M8 1.5l6.5 5.5h-2V14H9.5v-4h-3v4H3.5V7h-2z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 20" className="h-3.5 w-3" fill="currentColor">
          <path d="M8 0a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" />
        </svg>
      )}
    </span>
  )
}

/** Place name on the first line, the rest (city, state, ZIP) muted underneath. */
function PlaceLabel({ label }: { label: string }) {
  const cut = label.indexOf(', ')
  const head = cut > 0 ? label.slice(0, cut) : label
  const tail = cut > 0 ? label.slice(cut + 2) : ''
  return (
    <span className="min-w-0 leading-tight">
      <span className="block truncate font-medium text-ink">{head}</span>
      {tail && <span className="block truncate text-xs text-ink-3">{tail}</span>}
    </span>
  )
}
