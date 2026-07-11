import { useState } from 'react'
import { Power, Zap } from './icons'
import { motion } from 'framer-motion'
import type { CommandFn } from '../lib/ws'
import type { Device, Priorite } from '../types'
import { APPAREILS, controlDevice, estGenerique, renameDevice } from '../lib/appareils'
import { anomalieDe } from '../lib/anomalie'
import { DEMO_ONLY } from '../lib/config'
import { Card } from './ui'

const MAX_W = 2000

const prioMeta: Record<Priorite, { label: string; cls: string }> = {
  essentiel: { label: 'Essentiel', cls: 'bg-accentsoft text-accenttext ring-accentline' },
  reportable: { label: 'Reportable', cls: 'bg-sky-500/12 text-sky-600 ring-sky-500/25' },
  confort: { label: 'Confort', cls: 'bg-surface2 text-muted ring-line' },
}

function DeviceRow({ d, i, demo, command }: { d: Device; i: number; demo: boolean; command: CommandFn }) {
  const off = d.etat === 'off'
  const pct = Math.min(100, (d.conso_w / MAX_W) * 100)
  const meta = prioMeta[d.priorite]
  const ano = anomalieDe(d) // consommation anormale = défaut probable (badge + encart d'alerte)
  const [nom, setNom] = useState(estGenerique(d.nom) ? '' : d.nom)
  const [busy, setBusy] = useState(false)

  // Coupe / rallume : direct sur le relais (réel) ou le simulateur (démo). SANS IA.
  const toggle = async (action: 'couper' | 'rallumer') => {
    if (busy) return
    setBusy(true)
    try {
      if (demo) command(d.nom, action)
      else await controlDevice(d.id, action)
    } finally {
      setBusy(false)
    }
  }

  // Assigne l'appareil branché sur cette prise (= la renomme). L'IA le reconnaît ensuite.
  const commitNom = async () => {
    const cible = nom.trim() || `Prise ${d.prise_id}`
    if (cible !== d.nom) await renameDevice(d.id, cible)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * i, duration: 0.4 }}
      className={`rounded-2xl border bg-surface p-4 transition-colors ${ano ? 'border-rose-500/60 ring-1 ring-rose-500/30' : 'border-line hover:border-accentline'}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`grid h-10 w-10 place-items-center rounded-xl ${ano ? 'bg-rose-500/15 text-rose-600' : off ? 'bg-surface2 text-muted' : 'bg-accentsoft text-accenttext'}`}>
            <Zap size={18} strokeWidth={2.4} />
          </div>
          <div>
            <p className="font-semibold text-ink">{d.nom}</p>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${meta.cls}`}>
                {meta.label}
              </span>
              {ano && (
                <span className="inline-block rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-600 ring-1 ring-rose-500/30">
                  ⚠️ Anormal
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={`font-display text-lg font-bold tnum ${off ? 'text-muted' : 'text-ink'}`}>
            {off ? '0' : Math.round(d.conso_w)}
            <span className="ml-0.5 text-xs font-semibold text-muted">W</span>
          </p>
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${off ? 'text-muted' : 'text-accenttext'}`}>
            <Power size={11} strokeWidth={3} />
            {off ? 'Coupé' : 'Allumé'}
          </span>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface2">
        <motion.div
          className={`h-full rounded-full ${ano || d.conso_w > 800 ? 'bg-rose-500' : 'bg-brand-500'}`}
          animate={{ width: `${off ? 0 : pct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {ano && (
        <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-[12px] font-medium leading-snug text-rose-600 ring-1 ring-rose-500/20">
          {ano.message}
        </p>
      )}

      {/* Appareil branché sur cette prise. Inutile dans la vitrine publique : sans boîtier à
          associer, un champ grisé n'est que du bruit à l'écran. */}
      {!DEMO_ONLY && (
        <>
          <input
            list={`appareils-${d.id}`}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            onBlur={commitNom}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            disabled={demo}
            placeholder={demo ? 'Appareil (mode réel)' : 'Appareil branché…'}
            className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-accentline disabled:opacity-50"
          />
          <datalist id={`appareils-${d.id}`}>
            {APPAREILS.map((a) => <option key={a} value={a} />)}
          </datalist>
        </>
      )}

      {/* Boutons de contrôle direct (sans IA) */}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          onClick={() => toggle('rallumer')}
          disabled={busy}
          className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors disabled:opacity-60 ${
            !off ? 'bg-brand-500 text-white shadow-[var(--shadow-lift)]' : 'bg-surface2 text-muted ring-1 ring-line hover:text-ink'
          }`}
        >
          <Power size={15} strokeWidth={2.6} /> Allumer
        </button>
        <button
          onClick={() => toggle('couper')}
          disabled={busy}
          className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors disabled:opacity-60 ${
            off ? 'bg-rose-500 text-white shadow-[var(--shadow-lift)]' : 'bg-surface2 text-muted ring-1 ring-line hover:text-ink'
          }`}
        >
          <Power size={15} strokeWidth={2.6} /> Éteindre
        </button>
      </div>

      {d.replanifie_a && <p className="mt-2 text-[11px] text-muted">Rallumage prévu à {d.replanifie_a}</p>}
    </motion.div>
  )
}

export function DeviceList({
  devices, demo, command,
}: { devices: Device[]; demo: boolean; command: CommandFn }) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-ink">Appareils</h2>
        <span className="text-sm font-medium text-muted">{devices.length} connectés</span>
      </div>

      <div className="space-y-3">
        {devices.map((d, i) => (
          <DeviceRow key={d.id} d={d} i={i} demo={demo} command={command} />
        ))}
      </div>
    </Card>
  )
}
