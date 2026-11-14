/**
 * Light or dark theme: the system preference until the user picks one with the toggle, which is
 * remembered in localStorage. The `dark` class on <html> drives the Tailwind tokens; the map
 * subscribes and swaps the OpenFreeMap style.
 */
import { create } from 'zustand'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'spotter-theme'

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useTheme = create<{ theme: Theme; explicit: boolean }>(() => ({
  theme: 'light',
  explicit: false,
}))

/** Read the saved or system theme, apply it, and follow system changes until the user picks. */
export function initTheme(): () => void {
  const saved = storedTheme()
  const theme = saved ?? systemTheme()
  useTheme.setState({ theme, explicit: saved !== null })
  apply(theme)
  if (typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (useTheme.getState().explicit) return
    const next = systemTheme()
    useTheme.setState({ theme: next })
    apply(next)
  }
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

export function setTheme(theme: Theme): void {
  useTheme.setState({ theme, explicit: true })
  apply(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}
