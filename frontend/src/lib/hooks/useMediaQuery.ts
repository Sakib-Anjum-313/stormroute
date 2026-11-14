import { useCallback, useSyncExternalStore } from 'react'

/** Live `matchMedia` result; `false` where matchMedia is missing (jsdom, very old browsers). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  const read = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  return useSyncExternalStore(subscribe, read, () => false)
}

/** Below Tailwind's `md` breakpoint: the map-on-top, bottom-sheet layout. */
export const MOBILE_QUERY = '(max-width: 767.98px)'
