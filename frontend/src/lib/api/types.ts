/**
 * Short aliases for the generated OpenAPI types. Nothing here is hand-written: every type comes
 * from `schema.d.ts` (regenerate with `make api-types`).
 */
import type { components, operations } from './schema'

type Schemas = components['schemas']

export type Plan = Schemas['Plan']
export type PlanRoute = Schemas['PlanRoute']
export type StreamRoute = Schemas['Route']
export type Checkpoint = Schemas['Checkpoint']
export type Aggregates = Schemas['Aggregates']
export type Recommendation = Schemas['Recommendation']
export type Heatmap = Schemas['Heatmap']
export type HosStop = Schemas['HosStop']
export type Warning = Schemas['Warning']
export type RiskLevel = Schemas['RiskLevelEnum']
export type PlanRequest = Schemas['PlanRequestRequest']
export type Place = Schemas['PlaceInRequest']
export type PlanStreamEvent = Schemas['PlanStreamEvent']
export type ErrorBody = Schemas['ErrorBody']
export type ErrorCode = Schemas['ErrorBodyCodeEnum']
export type GeocodeResult = Schemas['GeocodeResult']
export type GeocodeResponse = Schemas['GeocodeResponse']

/** The `X-Fixture` scenarios the backend accepts in `PLAN_FIXTURES=1` mode. */
export type FixtureScenario = NonNullable<
  NonNullable<operations['plan']['parameters']['header']>['X-Fixture']
>

/** The interval keys of `PlanRoute.intervals` and `Plan.recommendation`. */
export type IntervalMi = keyof Schemas['Intervals']
export const INTERVALS_MI = [10, 25, 50] as const satisfies readonly IntervalMi[]
