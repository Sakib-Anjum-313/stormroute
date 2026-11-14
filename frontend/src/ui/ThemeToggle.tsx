import { setTheme, useTheme } from '../store/theme'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme((s) => s.theme)
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-2 shadow-sm hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${className}`}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 20 20" aria-hidden className="size-4" fill="currentColor">
          <circle cx="10" cy="10" r="4" />
          <path
            d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2L16 16M4 16l1.8-1.8M14.2 5.8L16 4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden className="size-4" fill="currentColor">
          <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" />
        </svg>
      )}
    </button>
  )
}
