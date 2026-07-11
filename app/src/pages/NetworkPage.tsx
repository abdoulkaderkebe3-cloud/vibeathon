import { Activity, Plug, Sparkles, Zap } from '../components/icons'
import type { IconType } from '../components/icons'
import { Card, Reveal } from '../components/ui'
import type { EcoWattState } from '../types'

function StatusRow({ icon: Icon, label, value, ok }: { icon: IconType; label: string; value: string; ok: boolean }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className={`grid h-11 w-11 place-items-center rounded-2xl ring-1 ${ok ? 'bg-accentsoft text-accenttext ring-accentline' : 'bg-rose-500/12 text-rose-500 ring-rose-500/25'}`}>
        <Icon size={22} strokeWidth={2.3} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        <p className="flex items-center gap-2 font-display text-base font-bold text-ink">
          <span className={`h-2 w-2 rounded-full ${ok ? 'bg-brand-500' : 'bg-rose-500'}`} />
          {value}
        </p>
      </div>
    </Card>
  )
}

export function NetworkPage({ state, mock, connected }: { state: EcoWattState; mock: boolean; connected: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Reveal delay={0.02}>
          <StatusRow icon={Activity} label="Mode" value={mock ? 'Démo (simulateur)' : 'Réel'} ok />
        </Reveal>
        <Reveal delay={0.08}>
          <StatusRow icon={Plug} label="Backend" value={mock ? 'Local simulé' : connected ? 'Connecté' : 'Déconnecté'} ok={mock || connected} />
        </Reveal>
        <Reveal delay={0.14}>
          <StatusRow icon={Sparkles} label="Cerveau IA" value="Llama 3.3 70B · Groq" ok />
        </Reveal>
        <Reveal delay={0.2}>
          <StatusRow icon={Zap} label="Transport" value="WebSocket direct" ok />
        </Reveal>
      </div>

      <Reveal delay={0.26}>
        <Card interactive={false} className="p-6">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">Prises connectées</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-3 pr-4 font-semibold">Prise</th>
                  <th className="py-3 pr-4 font-semibold">Appareil</th>
                  <th className="py-3 pr-4 font-semibold">Puissance</th>
                  <th className="py-3 font-semibold">État</th>
                </tr>
              </thead>
              <tbody>
                {state.devices.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs font-semibold text-ink">{d.prise_id}</td>
                    <td className="whitespace-nowrap py-3 pr-4 font-semibold text-ink">{d.nom}</td>
                    <td className="whitespace-nowrap py-3 pr-4 tnum text-ink/70">{d.etat === 'on' ? `${Math.round(d.conso_w)} W` : '0 W'}</td>
                    <td className="py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${d.etat === 'on' ? 'text-accenttext' : 'text-muted'}`}>
                        <span className={`h-2 w-2 rounded-full ${d.etat === 'on' ? 'bg-brand-500' : 'bg-muted'}`} />
                        {d.etat === 'on' ? 'Actif' : 'Coupé'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted">
            {mock
              ? 'En mode démo, les prises sont simulées localement. En réel, chaque prise ESP32 ouvre une connexion WebSocket vers le backend.'
              : 'Chaque prise ESP32 est reliée au backend par WebSocket direct (sans broker).'}
          </p>
        </Card>
      </Reveal>
    </div>
  )
}
