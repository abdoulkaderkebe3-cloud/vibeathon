import { motion } from 'framer-motion'
import { Power, Scissors, Sparkles } from '../components/icons'
import { StatCard } from '../components/StatCard'
import { Card, Reveal } from '../components/ui'
import type { ActionIA, Decision, EcoWattState } from '../types'

const meta: Record<ActionIA, { icon: typeof Scissors; bg: string; ring: string; text: string; label: string }> = {
  couper: { icon: Scissors, bg: 'bg-rose-500/12', ring: 'ring-rose-500/25', text: 'text-rose-500', label: 'Coupure' },
  rallumer: { icon: Power, bg: 'bg-accentsoft', ring: 'ring-accentline', text: 'text-accenttext', label: 'Rallumage' },
  garder: { icon: Sparkles, bg: 'bg-surface2', ring: 'ring-line', text: 'text-muted', label: 'Maintien' },
}

function heure(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function DecisionsPage({ state }: { state: EcoWattState }) {
  const coupures = state.decisions.filter((d) => d.action === 'couper').length
  const rallumages = state.decisions.filter((d) => d.action === 'rallumer').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
        <Reveal delay={0.02}><StatCard icon={Sparkles} label="Décisions" value={state.decisions.length} unit="" hint="Récentes" /></Reveal>
        <Reveal delay={0.08}><StatCard icon={Scissors} label="Coupures" value={coupures} unit="" hint="Gaspillage évité" /></Reveal>
        <Reveal delay={0.14}><StatCard icon={Power} label="Rallumages" value={rallumages} unit="" hint="En heures creuses" highlighted /></Reveal>
      </div>

      <Card interactive={false} className="p-6">
        <div className="mb-5 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white">
            <Sparkles size={17} strokeWidth={2.4} />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold leading-none text-ink">Historique des décisions</h2>
            <p className="text-xs text-muted">Chaque intervention de l'IA, avec sa justification</p>
          </div>
        </div>

        {state.decisions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Aucune décision pour l'instant.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {state.decisions.map((d: Decision, i) => {
              const m = meta[d.action]
              const Icon = m.icon
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.4 }}
                  className="rounded-2xl border border-line bg-surface p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${m.bg} ${m.ring} ${m.text}`}>
                      <Icon size={18} strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-bold ${m.text}`}>{m.label}</span>
                        <span className="shrink-0 text-xs text-muted">{heure(d.timestamp)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink/80">{d.raison}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
