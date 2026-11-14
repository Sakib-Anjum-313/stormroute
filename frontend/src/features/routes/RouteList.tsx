import { usePlanStore } from '../../store/planStore'
import { RouteCard, RouteCardSkeleton } from './RouteCard'

/**
 * The route cards. While routing runs there are three skeletons; once the `routes` event lands the
 * cards show distance, duration and arrival with a skeleton risk section; the result fills it in.
 * Cards follow the interval toggle. Nothing here subscribes to the slider hour.
 */
export function RouteList() {
  const phase = usePlanStore((s) => s.phase)
  const routes = usePlanStore((s) => s.routes)
  const plan = usePlanStore((s) => s.plan?.plan ?? null)
  const interval = usePlanStore((s) => s.interval)
  const originTz = usePlanStore((s) => s.originTz)
  const applyHos = usePlanStore((s) => s.plan?.plan.apply_hos ?? s.request?.apply_hos ?? false)

  if (phase === 'routing') {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading routes">
        <RouteCardSkeleton />
        <RouteCardSkeleton />
        <RouteCardSkeleton />
      </div>
    )
  }
  if (routes.length === 0 || (phase !== 'weather' && phase !== 'done')) return null

  const recommendedId = plan?.recommendation[interval].route_id ?? null
  return (
    <ul
      aria-label="Routes"
      aria-busy={plan === null}
      className="space-y-2"
      data-testid={plan ? 'plan-summary' : undefined}
    >
      {routes.map((route) => (
        <li key={route.id}>
          <RouteCard
            route={route}
            scored={plan?.routes.find((r) => r.id === route.id) ?? null}
            interval={interval}
            recommended={route.id === recommendedId}
            applyHos={applyHos}
            originTz={originTz}
          />
        </li>
      ))}
    </ul>
  )
}
