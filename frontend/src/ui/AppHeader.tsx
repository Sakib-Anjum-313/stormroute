/**
 * Top bar in the spotter.ai style: a navy glass strip with the brand mark, a three-step guide that
 * follows the plan phase, the API status and the theme toggle. A thin brand line along the bottom
 * shows planning progress. It subscribes to phase and progress only, never to the slider hour.
 */
import { useApiStatus, type ApiStatus } from '../store/apiStatus'
import { usePlanStore, type PlanState } from '../store/planStore'
import { ThemeToggle } from './ThemeToggle'

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#40e0d0" />
          <stop offset="1" stopColor="#008080" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
      <path
        d="M9.5 23c0-5.5 6.5-3.5 7-8.5s6-4.5 6-7"
        fill="none"
        stroke="#061830"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="0.1 4.2"
      />
      <circle cx="9.5" cy="23" r="3.2" fill="#fff" stroke="#061830" strokeWidth="2" />
      <circle cx="22.5" cy="8" r="3.4" fill="#f84960" stroke="#061830" strokeWidth="1.6" />
    </svg>
  )
}

const STEPS = ['Enter trip', 'Scan weather', 'Compare routes'] as const

function currentStep(phase: PlanState['phase']): number {
  if (phase === 'routing' || phase === 'weather') return 1
  if (phase === 'done') return 2
  return 0
}

function Steps() {
  const phase = usePlanStore((s) => s.phase)
  const current = currentStep(phase)
  return (
    <ol aria-label="Planning steps" className="hidden items-center gap-1 text-[13px] lg:flex">
      {STEPS.map((label, i) => {
        const done = i < current || (phase === 'done' && i === current)
        const active = i === current && phase !== 'done'
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && (
              <span
                aria-hidden
                className={`mx-1 h-px w-8 transition-colors duration-500 ${i <= current ? 'bg-brand-teal/70' : 'bg-white/15'}`}
              />
            )}
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-full px-2.5 py-1 transition-colors duration-300 ${
                active ? 'bg-white/10 text-white' : done ? 'text-white/85' : 'text-white/45'
              }`}
            >
              <span
                aria-hidden
                className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300 ${
                  done
                    ? 'bg-brand-teal text-brand-navy'
                    : active
                      ? 'bg-white text-brand-navy shadow-[0_0_0_4px_rgb(64_224_208/0.25)]'
                      : 'border border-white/25'
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 12 12" className="size-3">
                    <path
                      d="M2.5 6.5l2.2 2.2 4.8-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {label}
              <span className="sr-only">{done ? ' (done)' : active ? ' (current)' : ''}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const STATUS: Record<ApiStatus, { label: string; dot: string; halo: boolean }> = {
  checking: { label: 'Connecting', dot: 'bg-white/50 text-white/50', halo: true },
  waking: { label: 'Waking server', dot: 'bg-amber-300 text-amber-300', halo: true },
  ready: { label: 'Live', dot: 'bg-brand-teal text-brand-teal', halo: false },
  unreachable: { label: 'Offline', dot: 'bg-brand-coral text-brand-coral', halo: false },
}

function StatusPill() {
  const status = useApiStatus((s) => s.status)
  const s = STATUS[status]
  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/75 sm:flex"
      title="Planning API status"
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${s.dot} ${s.halo ? 'animate-halo' : ''}`}
      />
      <span>
        <span className="sr-only">Server: </span>
        {s.label}
      </span>
    </span>
  )
}

/** Brand line along the header's bottom edge: sweeps while routing, fills with weather progress. */
function ProgressLine() {
  const phase = usePlanStore((s) => s.phase)
  const progress = usePlanStore((s) => s.progress)
  const busy = phase === 'routing' || phase === 'weather'
  const share =
    phase === 'weather' && progress && progress.total > 0 ? progress.done / progress.total : null
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden transition-opacity duration-500 ${busy ? 'opacity-100' : 'opacity-0'}`}
    >
      {!busy ? null : share === null ? (
        <span className="animate-sweep absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-brand-teal to-brand-coral" />
      ) : (
        <span
          className="absolute inset-0 origin-left bg-gradient-to-r from-brand-teal to-brand-coral transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${Math.max(0.04, share)})` }}
        />
      )}
    </div>
  )
}

export function AppHeader() {
  return (
    <header
      className="relative z-30 flex h-14 shrink-0 items-center gap-4 border-b border-white/10 px-4 text-white backdrop-blur-[14px] backdrop-saturate-150 md:h-16 md:px-6"
      style={{ backgroundColor: 'var(--header-bg)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <LogoMark className="size-8 md:size-9" />
        <div className="min-w-0 leading-tight">
          <h1 className="text-[17px] font-bold tracking-tight md:text-lg">Spotter</h1>
          <p className="truncate text-[11px] text-white/60 md:text-xs">
            Weather-aware truck routing
          </p>
        </div>
      </div>
      <div className="mx-auto">
        <Steps />
      </div>
      <div className="ml-auto flex items-center gap-2 lg:ml-0">
        <StatusPill />
        <ThemeToggle />
      </div>
      <ProgressLine />
    </header>
  )
}
