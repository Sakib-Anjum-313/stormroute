import { setTheme, useTheme } from '../store/theme'

/** Sun/moon toggle styled for the navy header bar; the icon spins as it swaps. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme((s) => s.theme)
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`group flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition-colors hover:bg-white/12 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:outline-none ${className}`}
    >
      <svg
        key={theme}
        viewBox="0 0 20 20"
        aria-hidden
        className="size-4 animate-[spin-in_420ms_cubic-bezier(0.2,0.8,0.2,1)]"
        fill="currentColor"
      >
        {theme === 'dark' ? (
          <>
            <circle cx="10" cy="10" r="4" />
            <path
              d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2L16 16M4 16l1.8-1.8M14.2 5.8L16 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" />
        )}
      </svg>
    </button>
  )
}
