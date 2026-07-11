import { ConsumptionChart, type Point } from '../components/ConsumptionChart'
import { Card, Reveal } from '../components/ui'
import type { ActionIA, EcoWattState } from '../types'

const actionLabel: Record<ActionIA, { label: string; cls: string }> = {
  couper: { label: 'Coupure', cls: 'bg-rose-500/12 text-rose-500 ring-rose-500/25' },
  rallumer: { label: 'Rallumage', cls: 'bg-accentsoft text-accenttext ring-accentline' },
  garder: { label: 'Maintien', cls: 'bg-surface2 text-muted ring-line' },
}

function heure(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function nomAppareil(state: EcoWattState, id: string) {
  if (id === '*') return 'Tous les appareils'
  return state.devices.find((d) => d.id === id)?.nom ?? id ?? '—'
}

export function HistoryPage({ state, history }: { state: EcoWattState; history: Point[] }) {
  const totalWatts = state.devices.reduce((s, d) => s + (d.etat === 'on' ? d.conso_w : 0), 0)

  return (
    <div className="space-y-6">
      <Reveal delay={0.02}>
        <ConsumptionChart data={history} current={totalWatts} />
      </Reveal>

      <Reveal delay={0.1}>
        <Card interactive={false} className="p-6">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">Journal des évènements</h2>
          {state.decisions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Aucun évènement enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-3 pr-4 font-semibold">Heure</th>
                    <th className="py-3 pr-4 font-semibold">Action</th>
                    <th className="py-3 pr-4 font-semibold">Appareil</th>
                    <th className="py-3 font-semibold">Raison</th>
                  </tr>
                </thead>
                <tbody>
                  {state.decisions.map((d) => {
                    const a = actionLabel[d.action]
                    return (
                      <tr key={d.id} className="border-b border-line last:border-0">
                        <td className="whitespace-nowrap py-3 pr-4 text-muted tnum">{heure(d.timestamp)}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${a.cls}`}>{a.label}</span>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 font-semibold text-ink">{nomAppareil(state, d.device_id)}</td>
                        <td className="py-3 text-ink/70">{d.raison}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  )
}
