// The WAI-ARIA combobox pattern needs role=listbox/option: <datalist> cannot show async results
// with an active option, so this file opts out of prefer-tag-over-role.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'

import { fetchGeocode, GEOCODE_MIN_CHARS } from '../../lib/api/geocode'
import type { GeocodeResult, Place } from '../../lib/api/types'

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
      setActive((i) => (options.length ? (i + 1) % options.length : -1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1))
    } else if (event.key === 'Enter') {
      const option = options[active] ?? (options.length === 1 ? options[0] : undefined)
      if (showList && option) {
        event.preventDefault()
        pick(option)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const status =
    !enabled || results.isFetching
      ? null
      : results.isError
        ? 'Place search is unavailable. Try again.'
        : options.length === 0
          ? `No matches for '${query}'`
          : null

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
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
        aria-activedescendant={active >= 0 && showList ? `${listId}-${active}` : undefined}
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
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/30 aria-invalid:border-red-500"
      />
      {value && (
        <span
          className="pointer-events-none absolute top-8 right-3 text-xs text-emerald-700"
          aria-hidden
        >
          ✓
        </span>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList}
        className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
      >
        {options.map((option, i) => (
          <div
            key={`${option.label}-${option.lat}-${option.lon}`}
            id={`${listId}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            // Pick on mousedown so the input's blur does not close the list first.
            onMouseDown={(event) => {
              event.preventDefault()
              pick(option)
            }}
            className="cursor-pointer px-3 py-2 aria-selected:bg-sky-50 hover:bg-slate-50"
          >
            {option.label}
          </div>
        ))}
      </div>
      {open && status && <output className="mt-1 block text-xs text-slate-500">{status}</output>}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
