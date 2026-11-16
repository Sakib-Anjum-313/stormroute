import { usePlanStore } from '../../store/planStore'
import { noWeatherAnywhere, whySentence, whyTable } from './explain'

/**
 * "Why this route?": the comparator steps 0-5 for every route, the decisive cell highlighted and
 * one sentence with the numbers. Follows the interval toggle; never re-ranks anything.
 */
export function WhyPanel() {
  const plan = usePlanStore((s) => s.plan)
  const interval = usePlanStore((s) => s.interval)
  if (!plan) return null

  const rec = plan.plan.recommendation[interval]
  const routes = plan.routes
  const labelOf = (id: string) => routes.find((r) => r.id === id)?.label ?? `Route ${id}`
  const rows = whyTable(
    rec,
    routes.map((r) => r.id),
  )
  const partial = plan.plan.warnings.some((w) => w.code === 'WEATHER_PARTIAL')
  const blind = noWeatherAnywhere(rec)

  return (
    <section
      aria-labelledby="why-heading"
      className="animate-fade space-y-3 rounded-2xl border border-line bg-surface-2/60 p-3.5"
      data-testid="why-panel"
    >
      <h2 id="why-heading" className="text-[15px] font-semibold tracking-tight text-ink">
        Why this route?
      </h2>
      <p className="text-sm text-ink-2" data-testid="why-sentence">
        {whySentence(rec, labelOf)}
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">
            Comparator steps at {interval}-mile sampling. Lower is better at each step; the first
            step that differs decides.
          </caption>
          <thead className="bg-surface-2 text-ink-3">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Step
              </th>
              {routes.map((r) => (
                <th key={r.id} scope="col" className="px-2 py-1.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 rounded-[3px]"
                      style={{ backgroundColor: r.hex }}
                    />
                    <span className={r.id === rec.route_id ? 'font-semibold text-ink' : ''}>
                      {r.id}
                    </span>
                    {r.id === rec.route_id && <span className="sr-only"> (recommended)</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.step}
                className={`border-t border-line ${row.moot ? 'text-ink-3' : 'text-ink-2'}`}
                aria-current={row.decisive ? 'true' : undefined}
              >
                <th scope="row" className="px-2 py-1.5 text-left font-normal">
                  <span className="mr-1 text-ink-3 tabular-nums">{row.index}</span>
                  {row.label}
                  {row.decisive && (
                    <span className="btn-primary ml-1.5 rounded-full px-1.5 py-px text-[10px] font-semibold">
                      decides
                    </span>
                  )}
                </th>
                {row.cells.map((cell) => {
                  const highlight = row.decisive && cell.winner
                  return (
                    <td
                      key={cell.routeId}
                      data-decisive={highlight || undefined}
                      className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${
                        highlight
                          ? 'bg-accent-soft font-semibold text-ink ring-2 ring-accent ring-inset'
                          : cell.lostHere
                            ? 'font-medium text-ink underline decoration-dotted underline-offset-2'
                            : ''
                      }`}
                    >
                      {cell.text}
                      {cell.lostHere && <span className="sr-only"> (lost here)</span>}
                      {highlight && <span className="sr-only"> (decisive)</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-3">
        Lower wins at each step; later steps only break ties. Dotted values lost at that step.
        {rec.decisive_step === 'route_order' && ' Every step tied, so provider order decides.'}
        {partial && ' Partial: checkpoints without weather data are left out of average risk.'}
        {blind &&
          ' No route has any weather data, so this ranking is by travel time only: check the weather before you go.'}
      </p>
    </section>
  )
}
