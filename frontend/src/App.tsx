import { lazy, Suspense } from 'react'

import { WhyPanel } from './features/explain/WhyPanel'
import { TimeSlider } from './features/heatmap/TimeSlider'
import { Legend } from './features/map/Legend'
import { PlanStatus } from './features/routes/PlanStatus'
import { PlanBanners } from './features/routes/PlanBanners'
import { RouteList } from './features/routes/RouteList'
import { ServerStatus } from './features/status/ServerStatus'
import { runPlan } from './features/trip-form/runPlan'
import { TripForm } from './features/trip-form/TripForm'
import type { PlanRequest } from './lib/api/types'

// maplibre-gl and deck.gl load in their own chunk so the form paints first (map-performance rule 9).
const MapView = lazy(() => import('./features/map/MapView'))

const submitPlan = (request: PlanRequest) => void runPlan(request)

export default function App() {
  return (
    <div className="flex h-full flex-col-reverse bg-slate-50 text-slate-900 md:flex-row">
      <aside className="flex h-[45%] w-full shrink-0 flex-col gap-5 overflow-y-auto border-slate-200 bg-white p-5 md:h-full md:w-[400px] md:border-r">
        <header>
          <h1 className="text-lg font-semibold tracking-tight">Spotter</h1>
          <p className="text-sm text-slate-500">Weather-aware truck routing</p>
        </header>
        <ServerStatus />
        <TripForm onSubmit={submitPlan} />
        <section aria-label="Plan">
          <PlanStatus />
        </section>
        <PlanBanners />
        <RouteList />
        <WhyPanel />
        <footer className="mt-auto text-[11px] text-slate-400">
          Routing by TomTom. Weather data by Open-Meteo.com (CC BY 4.0).
        </footer>
      </aside>
      <main className="relative min-h-0 flex-1">
        <Suspense
          fallback={<div className="absolute inset-0 animate-pulse bg-slate-200" aria-hidden />}
        >
          <MapView />
        </Suspense>
        <div className="pointer-events-none absolute inset-x-3 bottom-8 flex items-end gap-3">
          <div className="max-w-xl min-w-0 flex-1">
            <TimeSlider />
          </div>
          <div className="ml-auto hidden sm:block">
            <Legend />
          </div>
        </div>
      </main>
    </div>
  )
}
