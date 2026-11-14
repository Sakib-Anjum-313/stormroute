/**
 * Turns the backend's recommendation (comparator keys, `decided_by`, `decisive_step`) into the
 * "Why this route?" table and sentence. Display only: the backend ranked the routes, nothing here
 * re-compares them (risk-rules skill, section 6).
 */
import type { Recommendation } from '../../lib/api/types'
import { formatAvgRisk, formatDuration } from '../../lib/format/format'

export type Step = Recommendation['steps'][number]

export const STEP_LABEL: Record<Step, string> = {
  no_travel_mi: 'No Travel miles',
  severe_mi: 'Severe miles',
  high_mi: 'High miles',
  avg_risk: 'Average risk (0–4)',
  duration_min: 'Travel time',
}

export function formatStepValue(step: Step, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  switch (step) {
    case 'avg_risk':
      return formatAvgRisk(value)
    case 'duration_min':
      return formatDuration(value * 60)
    default:
      return `${value.toFixed(1)} mi`
  }
}

export interface WhyCell {
  routeId: string
  text: string
  /** This column is the recommended route. */
  winner: boolean
  /** This route lost to the winner at this step (`decided_by`). */
  lostHere: boolean
}

export interface WhyRow {
  step: Step
  index: number
  label: string
  cells: WhyCell[]
  /** The step that separated the winner from the runner-up. */
  decisive: boolean
  /** A step after the decisive one: it did not affect the ranking. */
  moot: boolean
}

export function whyTable(rec: Recommendation, routeIds: readonly string[]): WhyRow[] {
  const decisiveIndex =
    rec.decisive_step === null
      ? -1
      : rec.decisive_step === 'route_order'
        ? rec.steps.length
        : rec.steps.indexOf(rec.decisive_step)
  return rec.steps.map((step, index) => ({
    step,
    index,
    label: STEP_LABEL[step],
    decisive: index === decisiveIndex,
    moot: decisiveIndex >= 0 && index > decisiveIndex,
    cells: routeIds.map((routeId) => ({
      routeId,
      text: formatStepValue(step, rec.keys[routeId]?.[index]),
      winner: routeId === rec.route_id,
      lostHere: rec.decided_by[routeId] === step,
    })),
  }))
}

/** "A", "A and B", "A, B and C" */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** One sentence naming the deciding step and the numbers behind it. */
export function whySentence(rec: Recommendation, labelOf: (id: string) => string): string {
  const winner = labelOf(rec.route_id)
  const decisive = rec.decisive_step
  if (decisive === null) return `${winner} is the only route.`
  const others = rec.ranking.filter((id) => id !== rec.route_id)
  if (decisive === 'route_order') {
    const tied = others.filter((id) => rec.decided_by[id] === 'route_order')
    const earlier = others.filter((id) => rec.decided_by[id] !== 'route_order')
    const tail = earlier.length > 0 ? ` ${joinList(earlier.map(labelOf))} lost earlier.` : ''
    return `${winner} ties ${joinList(tied.map(labelOf))} on every step and wins on provider order.${tail}`
  }
  const n = rec.steps.indexOf(decisive)
  const value = (id: string) => formatStepValue(decisive, rec.keys[id]?.[n])
  const atStep = others.filter((id) => rec.decided_by[id] === decisive)
  const earlier = others.filter((id) => rec.decided_by[id] !== decisive)
  const lead = `${winner} wins at step ${n} (${STEP_LABEL[decisive]}): ${value(rec.route_id)} vs ${joinList(
    atStep.map((id) => `${labelOf(id)} ${value(id)}`),
  )}`
  if (earlier.length === 0) return `${lead}.`
  const parts = earlier.map((id) => {
    const step = rec.decided_by[id]
    const i = step === undefined || step === 'route_order' ? -1 : rec.steps.indexOf(step)
    return i >= 0
      ? `${labelOf(id)} at step ${i} (${STEP_LABEL[rec.steps[i] as Step]})`
      : labelOf(id)
  })
  return `${lead}; ${joinList(parts)} already lost.`
}
