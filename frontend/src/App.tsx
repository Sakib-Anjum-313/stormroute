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
import { AppHeader } from './ui/AppHeader'

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
      className="animate-fade space-y-4"
    >
      {children}
    </section>
  )
}

/** Desktop section title with a one-line hint. */
function PanelHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      <p className="truncate text-xs text-ink-3">{hint}</p>
    </div>
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
    <div role="tablist" aria-label="Panels" className="shrink-0 px-3 pt-3">
      <div className="relative flex rounded-xl bg-surface-2 p-1">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-surface shadow-sm ring-1 ring-line transition-transform duration-300 ease-out"
          style={{ transform: `translateX(${TABS.findIndex((t) => t.id === tab) * 100}%)` }}
        />
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
            className="relative flex-1 rounded-lg py-2 text-sm font-medium text-ink-3 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none aria-selected:text-ink"
          >
            {t.label}
          </button>
        ))}
      </div>
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
    <div className="flex h-dvh flex-col text-ink">
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row md:gap-3 md:p-3">
        <aside className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden max-md:rounded-t-2xl max-md:border-t max-md:border-line max-md:bg-surface max-md:shadow-[0_-12px_30px_-12px_rgb(0_0_0/0.3)] md:glass md:w-[420px] md:flex-none md:rounded-2xl">
          {mobile && <SheetTabs tab={tab} onChange={setTab} />}
          <div className="scroll-thin min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-5">
            <ServerStatus />
            <Panel id="trip" label="Trip" mobile={mobile} active={tab === 'trip'}>
              {!mobile && <PanelHeading title="Plan a trip" hint="Where, when and how heavy" />}
              <TripForm onSubmit={submitPlan} />
            </Panel>
            <Panel id="routes" label="Routes" mobile={mobile} active={tab === 'routes'}>
              {!mobile && (
                <PanelHeading title="Routes" hint="Three options, ranked by weather risk" />
              )}
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
            <footer className="border-t border-line pt-3 text-[11px] text-ink-3">
              Routing by TomTom. Weather data by Open-Meteo.com (CC BY 4.0).
            </footer>
          </div>
        </aside>

        <main className="relative order-first h-[50dvh] shrink-0 overflow-hidden md:order-none md:h-full md:min-w-0 md:flex-1 md:rounded-2xl md:shadow-[0_0_0_1px_var(--glass-edge),var(--shadow-panel)]">
          <Suspense
            fallback={<div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />}
          >
            <MapView />
          </Suspense>
          <div className="pointer-events-none absolute top-2 left-2 md:hidden">
            <Legend compact />
          </div>
          <div className="pointer-events-none absolute inset-x-2 bottom-7 flex items-end gap-3 md:inset-x-3 md:bottom-8">
            <div className="max-w-xl min-w-0 flex-1">
              <TimeSlider />
            </div>
            <div className="ml-auto hidden md:block">
              <Legend />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
