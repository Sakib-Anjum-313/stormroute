/**
 * Content of the map tooltip (hover) and popup (click). Levels, triggers and values come straight
 * from the backend; this only lays them out with units and text labels.
 */
import type { Checkpoint, HosStop, RiskLevel } from '../../lib/api/types'
import {
  formatDuration,
  formatInHr,
  formatMiles,
  formatMph,
  formatTime,
  etaLines,
} from '../../lib/format/format'
import type { MapPick } from '../../store/planStore'
import { LevelChip } from '../../ui/LevelChip'

export interface RouteRef {
  label: string
  hex: string
}

const KIND_LABEL: Record<Checkpoint['kind'], string> = {
  origin: 'Origin',
  interval: 'Checkpoint',
  destination: 'Destination',
}

const STOP_LABEL: Record<HosStop['kind'], string> = {
  break: '30-minute break',
  rest: '10-hour rest',
}

function RouteTag({ route }: { route: RouteRef | undefined }) {
  if (!route) return null
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
      <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: route.hex }} />
      {route.label}
    </span>
  )
}

function WeatherRow({
  name,
  value,
  level,
  note,
}: {
  name: string
  value: string
  level: RiskLevel | null
  note?: string
}) {
  return (
    <tr className="border-t border-line first:border-t-0">
      <th scope="row" className="py-1 pr-2 text-left font-normal text-ink-3">
        {name}
      </th>
      <td className="py-1 pr-2 text-right text-ink tabular-nums">{value}</td>
      <td className="py-1 text-right">
        {level ? <LevelChip level={level} /> : <span className="text-ink-3">{note}</span>}
      </td>
    </tr>
  )
}

export function CheckpointDetails({
  checkpoint: cp,
  route,
  originTz,
}: {
  checkpoint: Checkpoint
  route: RouteRef | undefined
  originTz: string | null
}) {
  const eta = etaLines(cp.eta_utc, originTz, cp.tz)
  const w = cp.weather
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <RouteTag route={route} />
        <span className="text-ink-2">
          {KIND_LABEL[cp.kind]} · mile {cp.mile.toFixed(1)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <LevelChip level={cp.level} />
        <span className="text-xs text-ink-3">covers {formatMiles(cp.owned_mi)} of road</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-ink-3">ETA</dt>
        <dd className="text-ink tabular-nums">{eta.origin}</dd>
        {eta.local && (
          <>
            <dt className="text-ink-3">Local</dt>
            <dd className="text-ink tabular-nums">{eta.local}</dd>
          </>
        )}
      </dl>
      {cp.status === 'no_data' || !w || !cp.levels ? (
        <p className="flex items-center gap-2 text-xs text-ink-2">
          <span aria-hidden className="hatch-no-data inline-block size-3 rounded-[2px]" />
          No weather data for this time and place. Its miles are left out of average risk.
        </p>
      ) : (
        <>
          <table className="w-full text-xs">
            <caption className="sr-only">Weather at the ETA</caption>
            <tbody>
              <WeatherRow name="Wind" value={formatMph(w.wind_mph)} level={cp.levels.wind} />
              <WeatherRow
                name="Gusts"
                value={formatMph(w.gust_mph)}
                level={null}
                note="not scored"
              />
              <WeatherRow name="Rain" value={formatInHr(w.rain_in_hr)} level={cp.levels.rain} />
              <WeatherRow name="Snow" value={formatInHr(w.snow_in_hr)} level={cp.levels.snow} />
            </tbody>
          </table>
          {cp.triggers.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-ink-2" aria-label="Rules triggered">
              {cp.triggers.map((t) => (
                <li key={t.rule} className="flex gap-1.5">
                  <span aria-hidden className="text-ink-3">
                    •
                  </span>
                  {t.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-2">All conditions are below the Moderate thresholds.</p>
          )}
        </>
      )}
    </div>
  )
}

export function StopDetails({
  stop,
  route,
  originTz,
}: {
  stop: HosStop
  route: RouteRef | undefined
  originTz: string | null
}) {
  const end = new Date(Date.parse(stop.start_utc) + stop.duration_s * 1000).toISOString()
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <RouteTag route={route} />
        <span className="text-ink-2">mile {stop.mile.toFixed(1)}</span>
      </div>
      <p className="font-semibold text-ink">
        Hours-of-service {STOP_LABEL[stop.kind]} ({formatDuration(stop.duration_s)})
      </p>
      <p className="text-ink-2 tabular-nums">
        {formatTime(stop.start_utc, originTz)} – {formatTime(end, originTz)}
      </p>
      <p className="text-ink-3">Weather while parked is not assessed.</p>
    </div>
  )
}

export function PickDetails({
  pick,
  routes,
  originTz,
}: {
  pick: MapPick
  routes: ReadonlyMap<string, RouteRef>
  originTz: string | null
}) {
  switch (pick.kind) {
    case 'checkpoint':
      return (
        <CheckpointDetails
          checkpoint={pick.checkpoint}
          route={routes.get(pick.routeId)}
          originTz={originTz}
        />
      )
    case 'stop':
      return <StopDetails stop={pick.stop} route={routes.get(pick.routeId)} originTz={originTz} />
    case 'place':
      return (
        <p className="text-sm">
          <span className="font-semibold text-ink">
            {pick.role === 'origin' ? 'Origin' : 'Destination'}
          </span>
          <span className="block text-ink-2">{pick.label}</span>
        </p>
      )
  }
}

/** One line for the hover tooltip. */
export function PickSummary({
  pick,
  routes,
  originTz,
}: {
  pick: MapPick
  routes: ReadonlyMap<string, RouteRef>
  originTz: string | null
}) {
  if (pick.kind === 'checkpoint') {
    const cp = pick.checkpoint
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <RouteTag route={routes.get(pick.routeId)} />
        <span className="text-ink-2 tabular-nums">mi {cp.mile.toFixed(0)}</span>
        <LevelChip level={cp.level} />
        <span className="text-ink-2 tabular-nums">{formatTime(cp.eta_utc, originTz)}</span>
        <span className="w-full text-[10px] text-ink-3">Click for details</span>
      </span>
    )
  }
  if (pick.kind === 'stop') {
    return (
      <span className="flex flex-wrap items-center gap-x-2 text-xs">
        <RouteTag route={routes.get(pick.routeId)} />
        <span className="text-ink-2">
          {STOP_LABEL[pick.stop.kind]} · {formatTime(pick.stop.start_utc, originTz)}
        </span>
      </span>
    )
  }
  return (
    <span className="text-xs text-ink">
      <span className="font-semibold">{pick.role === 'origin' ? 'Origin' : 'Destination'}:</span>{' '}
      {pick.label}
    </span>
  )
}
