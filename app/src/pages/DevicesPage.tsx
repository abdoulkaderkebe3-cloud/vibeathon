import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plug, Power, Zap } from '../components/icons'
import { StatCard } from '../components/StatCard'
import { Card, Reveal } from '../components/ui'
import type { CommandFn } from '../lib/ws'
import type { Device, EcoWattState } from '../types'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const MAX_W = 2000

// Appareils courants d'un foyer ivoirien (liste de suggestions, saisie libre possible).
const APPAREILS = [
  'Ventilateur', 'Lampe', 'Ampoule', 'Réfrigérateur', 'Congélateur', 'Télévision',
  'Décodeur', 'Fer à repasser', 'Bouilloire', 'Climatiseur', 'Chargeur téléphone',
  'Ordinateur', 'Machine à laver', 'Pompe à eau', 'Micro-ondes',
]

// Un nom "générique" (Prise 1/2) = pas encore d'appareil assigné.
const estGenerique = (nom: string) => /^prise\s*\d+$/i.test(nom.trim())

async function renameDevice(id: string, nom: string) {
  await fetch(`${API}/api/devices/${id}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom }),
  })
}

async function controlDevice(id: string, action: 'couper' | 'rallumer') {
  await fetch(`${API}/api/devices/${id}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

function DeviceControlCard({
  d, i, demo, command,
}: { d: Device; i: number; demo: boolean; command: CommandFn }) {
  const off = d.etat === 'off'
  const pct = Math.min(100, (d.conso_w / MAX_W) * 100)
  const [nom, setNom] = useState(estGenerique(d.nom) ? '' : d.nom)
  const [busy, setBusy] = useState(false)

  // Coupe / rallume : direct sur le relais (mode réel) ou sur le simulateur (démo). SANS IA.
  const toggle = async (action: 'couper' | 'rallumer') => {
    if (busy) return
    setBusy(true)
    try {
      if (demo) command(d.nom, action)
      else await controlDevice(d.id, action)
    } finally {
      setTimeout(() => setBusy(false), 300)
    }
  }

  // Assigne l'appareil branché sur cette prise (= la renomme). L'IA le reconnaîtra ensuite.
  const commitNom = async () => {
    const v = nom.trim()
    const cible = v || `Prise ${d.prise_id}`
    if (cible === d.nom) return
    await renameDevice(d.id, cible)
  }

  return (
    <Reveal delay={0.05 * i}>
      <Card className="p-5">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`grid h-12 w-12 place-items-center rounded-2xl ${off ? 'bg-surface2 text-muted' : 'bg-accentsoft text-accenttext'}`}>
              <Zap size={22} strokeWidth={2.3} />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-ink">{d.nom}</p>
              <p className="text-xs text-muted">Prise {d.prise_id}</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${off ? 'bg-surface2 text-muted' : 'bg-accentsoft text-accenttext'}`}>
            <Power size={12} strokeWidth={3} />
            {off ? 'Coupé' : 'Allumé'}
          </span>
        </div>

        {/* Sélecteur d'appareil branché sur cette prise */}
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
          Appareil branché
        </label>
        <input
          list={`appareils-${d.id}`}
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onBlur={commitNom}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
          disabled={demo}
          placeholder={demo ? 'Disponible en mode réel' : 'Choisir ou saisir un appareil…'}
          className="mb-4 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-accentline disabled:opacity-50"
        />
        <datalist id={`appareils-${d.id}`}>
          {APPAREILS.map((a) => <option key={a} value={a} />)}
        </datalist>

        <div className="mb-2 flex items-end justify-between">
          <span className="text-xs font-medium text-muted">Consommation</span>
          <p className={`font-display text-2xl font-extrabold tnum ${off ? 'text-muted' : 'text-ink'}`}>
            {off ? '0' : Math.round(d.conso_w)}
            <span className="ml-1 text-sm font-bold text-muted">W</span>
          </p>
        </div>

        <div className="mb-4 h-2.5 w-full overflow-hidden rounded-full bg-surface2">
          <motion.div
            className={`h-full rounded-full ${d.conso_w > 800 ? 'bg-rose-500' : 'bg-brand-500'}`}
            animate={{ width: `${off ? 0 : pct}%` }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        {/* Boutons de contrôle direct (sans IA) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => toggle('rallumer')}
            disabled={busy}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
              !off ? 'bg-brand-500 text-white shadow-[var(--shadow-lift)]' : 'bg-surface2 text-muted ring-1 ring-line hover:text-ink'
            }`}
          >
            <Power size={15} strokeWidth={2.6} /> Allumer
          </button>
          <button
            onClick={() => toggle('couper')}
            disabled={busy}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
              off ? 'bg-rose-500 text-white shadow-[var(--shadow-lift)]' : 'bg-surface2 text-muted ring-1 ring-line hover:text-ink'
            }`}
          >
            <Power size={15} strokeWidth={2.6} /> Éteindre
          </button>
        </div>

        {d.replanifie_a && <p className="mt-3 text-xs text-muted">Rallumage prévu à {d.replanifie_a}</p>}
      </Card>
    </Reveal>
  )
}

export function DevicesPage({
  state, demo, command,
}: { state: EcoWattState; demo: boolean; command: CommandFn }) {
  const actifs = state.devices.filter((d) => d.etat === 'on').length
  const coupes = state.devices.length - actifs
  const total = state.devices.reduce((s, d) => s + (d.etat === 'on' ? d.conso_w : 0), 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Reveal delay={0.02}><StatCard icon={Plug} label="Appareils" value={state.devices.length} unit="" hint="Prises connectées" /></Reveal>
        <Reveal delay={0.08}><StatCard icon={Power} label="Actifs" value={actifs} unit="" hint="Allumés" /></Reveal>
        <Reveal delay={0.14}><StatCard icon={Power} label="Coupés" value={coupes} unit="" hint="Par l'IA ou éteints" /></Reveal>
        <Reveal delay={0.2}><StatCard icon={Zap} label="Consommation" value={total} unit="W" hint="Totale actuelle" highlighted /></Reveal>
      </div>

      {demo && (
        <p className="rounded-xl bg-surface2 px-4 py-2.5 text-xs text-muted ring-1 ring-line">
          Tu es en mode Démo. Passe en mode Réel (en bas de la barre latérale) pour renommer les prises
          et piloter le vrai boîtier depuis cette page.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {state.devices.map((d, i) => (
          <DeviceControlCard key={d.id} d={d} i={i} demo={demo} command={command} />
        ))}
      </div>
    </div>
  )
}
