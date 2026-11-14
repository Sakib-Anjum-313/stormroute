import { render, screen } from '@testing-library/react'

import type { Checkpoint } from '../../lib/api/types'
import { CheckpointDetails, PickSummary, StopDetails } from './PickDetails'

const route = { label: 'Route A', hex: '#2a78d6' }

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    mile: 75,
    lat: 40.78,
    lon: -104.98,
    kind: 'interval',
    owned_mi: 25,
    eta_utc: '2026-11-15T14:05:30Z',
    tz: 'America/Denver',
    status: 'ok',
    weather: { wind_mph: 47.2, gust_mph: 61, rain_in_hr: 0.12, snow_in_hr: 0, cell: [40.8, -105] },
    level: 'NO_TRAVEL',
    score: 4,
    levels: { wind: 'NO_TRAVEL', rain: 'MODERATE', snow: 'LOW' },
    triggers: [
      { rule: 'wind_band', detail: 'wind 47.2 mph in [45, 55) → Severe' },
      {
        rule: 'load_45_54_over_30k',
        detail: 'wind 47.2 mph with 45,000 lb > 30,000 lb → No Travel',
      },
      { rule: 'rain_band', detail: 'rain 0.12 in/hr in [0.1, 0.25) → Moderate' },
    ],
    ...overrides,
  }
}

const rowText = (name: string) => screen.getByRole('rowheader', { name }).closest('tr')?.textContent

test('checkpoint popup: route, mile, kind, ETA, values with units, per-variable levels, triggers', () => {
  render(<CheckpointDetails checkpoint={checkpoint()} route={route} originTz="America/Denver" />)
  expect(screen.getByText('Route A')).toBeInTheDocument()
  expect(screen.getByText('Checkpoint · mile 75.0')).toBeInTheDocument()
  expect(screen.getByText('covers 25.0 mi of road')).toBeInTheDocument()
  expect(screen.getByText('Sun 07:05 MST')).toBeInTheDocument()
  expect(screen.queryByText('Local')).toBeNull()
  expect(rowText('Wind')).toBe('Wind47.2 mphNo Travel')
  expect(rowText('Gusts')).toBe('Gusts61.0 mphnot scored')
  expect(rowText('Rain')).toBe('Rain0.120 in/hrModerate')
  expect(rowText('Snow')).toBe('Snow0 in/hrLow')
  const rules = screen.getByRole('list', { name: 'Rules triggered' })
  expect(rules).toHaveTextContent('45,000 lb > 30,000 lb → No Travel')
  expect(rules.children).toHaveLength(3)
})

test('local time is added when the checkpoint is in another zone', () => {
  render(
    <CheckpointDetails
      checkpoint={checkpoint({ tz: 'America/Los_Angeles', kind: 'destination' })}
      route={route}
      originTz="America/Denver"
    />,
  )
  expect(screen.getByText('Destination · mile 75.0')).toBeInTheDocument()
  expect(screen.getByText('Local').nextSibling).toHaveTextContent('Sun 06:05 PST')
})

test('calm checkpoint says no rule fired', () => {
  render(
    <CheckpointDetails
      checkpoint={checkpoint({
        level: 'LOW',
        levels: { wind: 'LOW', rain: 'LOW', snow: 'LOW' },
        triggers: [],
      })}
      route={route}
      originTz="America/Denver"
    />,
  )
  expect(screen.getByText('All conditions are below the Moderate thresholds.')).toBeInTheDocument()
})

test('NO_DATA checkpoint is labelled, not shown as Low', () => {
  render(
    <CheckpointDetails
      checkpoint={checkpoint({
        status: 'no_data',
        weather: null,
        level: null,
        levels: null,
        score: null,
        triggers: [],
      })}
      route={route}
      originTz="America/Denver"
    />,
  )
  expect(screen.getByText('No data')).toBeInTheDocument()
  expect(screen.getByText(/No weather data for this time and place/)).toBeInTheDocument()
  expect(screen.queryByText('Low')).toBeNull()
})

test('hover summary is one line with the level as text', () => {
  render(
    <PickSummary
      pick={{ kind: 'checkpoint', routeId: 'A', checkpoint: checkpoint() }}
      routes={new Map([['A', route]])}
      originTz="America/Denver"
    />,
  )
  expect(screen.getByText('mi 75')).toBeInTheDocument()
  expect(screen.getByText('No Travel')).toBeInTheDocument()
  expect(screen.getByText('Click for details')).toBeInTheDocument()
})

test('HOS stop details', () => {
  render(
    <StopDetails
      stop={{
        kind: 'rest',
        mile: 639.6,
        lat: 40.2,
        lon: -111.7,
        start_utc: '2026-11-16T00:30:00Z',
        duration_s: 36000,
      }}
      route={route}
      originTz="America/Denver"
    />,
  )
  expect(screen.getByText('Hours-of-service 10-hour rest (10 h)')).toBeInTheDocument()
  expect(screen.getByText('Sun 17:30 MST – Mon 03:30 MST')).toBeInTheDocument()
})
