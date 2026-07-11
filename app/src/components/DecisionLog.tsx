import { Power, Scissors, Sparkles } from './icons'
import { AnimatePresence, motion } from 'framer-motion'
import type { ActionIA, Decision } from '../types'
import { Card } from './ui'

const meta: Record<ActionIA, { icon: typeof Scissors; ring: string; bg: string; text: string }> = {
  couper: { icon: Scissors, ring: 'ring-rose-500/25', bg: 'bg-rose-500/12', text: 'text-rose-500' },
  rallumer: { icon: Power, ring: 'ring-accentline', bg: 'bg-accentsoft', text: 'text-accenttext' },
  garder: { icon: Sparkles, ring: 'ring-line', bg: 'bg-surface2', text: 'text-muted' },
}

function heure(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function DecisionLog({ decisions }: { decisions: Decision[] }) {
  return (
    <Card className="flex flex-col p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white">
          <Sparkles size={17} strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold leading-none text-ink">Décisions de l'IA</h2>
          <p className="text-xs text-muted">Chaque coupure est expliquée</p>
        </div>
      </div>

      {decisions.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-center text-sm text-muted">
          En attente d'un événement...
        </div>
      ) : (
        <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {decisions.map((d) => {
              const m = meta[d.action]
              const Icon = m.icon
              return (
                <motion.div
                  key={d.id}
                  layout
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-2xl border border-line bg-surface p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${m.bg} ${m.ring} ${m.text}`}>
                      <Icon size={16} strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold uppercase tracking-wide ${m.text}`}>
                          {d.action}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">{heure(d.timestamp)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink/80">{d.raison}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </Card>
  )
}
