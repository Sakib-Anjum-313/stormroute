import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'

import { WhyPanel } from './features/explain/WhyPanel'
import { TimeSlider } from './features/heatmap/TimeSlider'
import { Legend } from './features/map/Legend'
import { PlanBanners } from './features/routes/PlanBanners'
import { PlanStatus } from './features/routes/PlanStatus'
import { RouteList } from './features/routes/RouteList'
import { ServerStatus } from './features/status/ServerStatus'
import { runPlan } from './features/trip-form/runPlan'
import { TripForm } from './features/trip-form/TripForm'
import type { PlanRequest } from './lib/api/types'
import { MOBILE_QUERY, useMediaQuery } from './lib/hooks/useMediaQuery'
import { usePlanStore } from './store/planStore'
import { ThemeToggle } from './ui/ThemeToggle'

// maplibre-gl and deck.gl load in their own chunk so the form paints first (map-performance rule 9).
const MapView = lazy(() => import('./features/map/MapView'))

const submitPlan = (request: PlanRequest) => void runPlan(request)

const TABS = [
  { id: 'trip', label: 'Trip' },
  { id: 'routes', label: 'Routes' },
  { id: 'why', label: 'Why' },
] as const
type TabId = (typeof TABS)[number]['id']

/** Desktop: a plain section. Mobile: one tab panel of the bottom sheet. */
function Panel({
  id,
  label,
  mobile,
  active,
  children,
}: {
  id: TabId
  label: string
  mobile: boolean
  active: boolean
  children: ReactNode
}) {
  if (!mobile) {
    return (
      <section aria-label={label} className="space-y-4">
        {children}
      </section>
    )
  }
  return (
    <section
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={!active}
      className="space-y-4"
    >
      {children}
    </section>
  )
}

function SheetTabs({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = TABS[(i + step + TABS.length) % TABS.length]
    if (!next) return
    onChange(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label="Panels"
      className="flex shrink-0 border-b border-line bg-surface px-2"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={onKeyDown}
          className="relative flex-1 py-2.5 text-sm font-medium text-ink-3 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset aria-selected:text-ink"
        >
          {t.label}
          {tab === t.id && (
            <span
              aria-hidden
              className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-accent"
            />
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * The panel comes first in the DOM so keyboard order is form, results, then map; on phones the map
 * is moved above the sheet visually with `order-first`.
 */
export default function App() {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const [tab, setTab] = useState<TabId>('trip')
  const hasPlan = usePlanStore((s) => s.plan !== null)

  // On the phone layout, show the Routes tab as soon as a plan starts.
  useEffect(
    () =>
      usePlanStore.subscribe((state, prev) => {
        if (state.phase === 'routing' && prev.phase !== 'routing') setTab('routes')
      }),
    [],
  )

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink md:flex-row">
      <aside className="flex min-h-0 flex-1 flex-col border-t border-line bg-surface shadow-[0_-4px_12px_rgb(0_0_0/0.06)] md:w-[400px] md:flex-none md:border-t-0 md:border-r md:shadow-none">
        <header className="hidden items-start justify-between px-5 pt-5 md:flex">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Spotter</h1>
            <p className="text-sm text-ink-3">Weather-aware truck routing</p>
          </div>
          <ThemeToggle />
        </header>
        {mobile && <SheetTabs tab={tab} onChange={setTab} />}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-5">
          <ServerStatus />
          <Panel id="trip" label="Trip" mobile={mobile} active={tab === 'trip'}>
            <TripForm onSubmit={submitPlan} />
          </Panel>
          <Panel id="routes" label="Routes" mobile={mobile} active={tab === 'routes'}>
            <PlanStatus />
            <PlanBanners />
            <RouteList />
          </Panel>
          <Panel id="why" label="Why this route" mobile={mobile} active={tab === 'why'}>
            {mobile && !hasPlan && (
              <p className="text-sm text-ink-2">Plan a trip to see why a route is recommended.</p>
            )}
            <WhyPanel />
          </Panel>
          <footer className="pt-2 text-[11px] text-ink-3">
            Routing by TomTom. Weather data by Open-Meteo.com (CC BY 4.0).
          </footer>
        </div>
      </aside>

      <main className="relative order-first h-[55dvh] shrink-0 md:order-none md:h-full md:min-w-0 md:flex-1">
        <Suspense
          fallback={<div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />}
        >
          <MapView />
        </Suspense>
        <div className="pointer-events-none absolute top-2 left-2 md:hidden">
          <Legend compact />
        </div>
        <ThemeToggle className="absolute top-[76px] right-2.5 md:hidden" />
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end gap-3 md:inset-x-3 md:bottom-8">
          <div className="max-w-xl min-w-0 flex-1">
            <TimeSlider />
          </div>
          <div className="ml-auto hidden md:block">
            <Legend />
          </div>
        </div>
      </main>
    </div>
  )
}
