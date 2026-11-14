import type { Map as MaplibreMap } from 'maplibre-gl'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'

import {
  pickPosition,
  pickTarget,
  pinPick,
  usePlanStore,
  type MapPick,
} from '../../store/planStore'
import { PickDetails, PickSummary, type RouteRef } from './PickDetails'
import { placePopover } from './placement'

/** Keep `el` placed next to the pick's map position; returns a function that re-places it. */
function usePlacement(
  map: MaplibreMap,
  pick: MapPick | null,
  ref: RefObject<HTMLElement | null>,
  follow: boolean,
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!pick || !el) return
    const place = () => {
      const container = map.getContainer()
      const point = map.project(pickPosition(pick))
      const { left, top } = placePopover(
        point,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: container.clientWidth, height: container.clientHeight },
      )
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    }
    place()
    if (!follow) return
    // Pan and zoom move the anchor: write the position straight to the DOM, no React render.
    map.on('move', place)
    return () => {
      map.off('move', place)
    }
  }, [map, pick, ref, follow])
}

/**
 * The single tooltip (hover) and popup (click) for map objects, positioned from the pick's map
 * coordinates. There is never one DOM node per checkpoint (map-performance rule 8).
 */
export function MapPopover({ map }: { map: MaplibreMap }) {
  const hoverPick = usePlanStore((s) => s.hoverPick)
  const pinnedPick = usePlanStore((s) => s.pinnedPick)
  const originTz = usePlanStore((s) => s.originTz)
  const routes = usePlanStore((s) => s.routes)
  const routeRefs = useMemo(
    () => new Map<string, RouteRef>(routes.map((r) => [r.id, { label: r.label, hex: r.hex }])),
    [routes],
  )
  const tipRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const showTip = hoverPick !== null && pickTarget(hoverPick) !== pickTarget(pinnedPick)

  usePlacement(map, showTip ? hoverPick : null, tipRef, false)
  usePlacement(map, pinnedPick, popRef, true)

  useEffect(() => {
    if (!pinnedPick) return
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') pinPick(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pinnedPick])

  return (
    <>
      {showTip && (
        <div
          ref={tipRef}
          role="tooltip"
          className="pointer-events-none absolute top-0 left-0 z-10 max-w-64 rounded-md border border-line bg-surface/95 px-2.5 py-1.5 shadow-lg backdrop-blur"
        >
          <PickSummary pick={hoverPick} routes={routeRefs} originTz={originTz} />
        </div>
      )}
      {pinnedPick && (
        <dialog
          open
          ref={popRef}
          aria-label="Map details"
          data-testid="map-popup"
          className="absolute top-0 right-auto left-0 z-20 m-0 w-72 max-w-[calc(100%-16px)] rounded-lg border border-line bg-surface p-3 pr-8 shadow-xl"
        >
          <button
            ref={closeRef}
            type="button"
            onClick={() => pinPick(null)}
            aria-label="Close details"
            className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <svg viewBox="0 0 12 12" aria-hidden className="size-3">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <PickDetails pick={pinnedPick} routes={routeRefs} originTz={originTz} />
        </dialog>
      )}
    </>
  )
}
