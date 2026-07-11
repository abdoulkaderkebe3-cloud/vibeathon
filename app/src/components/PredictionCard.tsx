import { useEffect, useMemo, useRef, useState } from 'react'
import { Coins, Gauge, Sparkles } from './icons'
import { AnimatedNumber, Card } from './ui'
import {
  fetchPredictionsReel,
  predireDepuisDevices,
  type PredictionFoyer,
} from '../lib/predictions'
import { consoStable } from '../lib/anomalie'
import type { Device, EcoWattState } from '../types'

function fmt(n: number, d = 0) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d })
}

/**
 * Prévision de facture PAR APPAREIL, sur les données réelles du boîtier (ADR-011).
 *  - En mode réel : interroge `GET /api/predictions` (mesures accumulées, énergie intégrée),
 *    et se rafraîchit toutes les 10 s. Repli sur la projection live si pas encore de mesures.
 *  - En mode démo : projette « à la puissance actuelle » depuis les watts du simulateur.
 */
export function PredictionCard({ state, demo }: { state: EcoWattState; demo: boolean }) {
  const [reel, setReel] = useState<PredictionFoyer | null>(null)

  // En réel, on va chercher la prédiction backend (mesures réelles) et on la rafraîchit.
  useEffect(() => {
    if (demo) return // en démo on ignore `reel` plus bas, inutile de le vider ici
    const ctrl = new AbortController()
    let alive = true
    const charger = async () => {
      const p = await fetchPredictionsReel(ctrl.signal)
      if (alive) setReel(p)
    }
    charger()
    const timer = setInterval(charger, 10000)
    return () => {
      alive = false
      ctrl.abort()
      clearInterval(timer)
    }
  }, [demo])

  // En démo, la projection « à la puissance actuelle » bondissait : gros appareil qui grimpe avant
  // coupure (bouilloire 1500 W), ondulations de fond, et surtout un pic ANORMAL (frigo en défaut).
  // Deux garde-fous pour une facture cohérente : (1) `consoStable` écrête un pic anormal à la conso
  // normale du type (un défaut transitoire ne définit pas la facture du mois) ; (2) EMA lent (α=0,08)
  // qui absorbe les ondulations. Un appareil éteint retombe à 0 tout de suite (on voit la coupure).
  // Le réel intègre déjà la vraie énergie côté backend : pas de lissage là-bas.
  const emaRef = useRef<Map<string, number>>(new Map())
  const [devicesLisses, setDevicesLisses] = useState<Device[]>(state.devices)
  useEffect(() => {
    if (!demo) return
    const ALPHA = 0.08
    const lisses = state.devices.map((d) => {
      const cible = consoStable(d) // écrête les pics anormaux avant lissage
      if (cible <= 0) {
        emaRef.current.set(d.id, 0)
        return { ...d, conso_w: 0 }
      }
      const prev = emaRef.current.get(d.id) ?? cible
      const val = ALPHA * cible + (1 - ALPHA) * prev
      emaRef.current.set(d.id, val)
      return { ...d, conso_w: Math.round(val) }
    })
    setDevicesLisses(lisses)
  }, [state, demo])

  // Projection live depuis les watts (démo lissée, ou repli si le backend n'a pas encore de mesures).
  const live = useMemo(
    () => predireDepuisDevices(demo ? devicesLisses : state.devices),
    [demo, devicesLisses, state.devices],
  )
  // En démo, la prédiction issue du backend n'a aucun sens : on la dérive au rendu plutôt que de
  // vider l'état dans un effet, ce qui provoquait un rendu en cascade.
  const pred = demo ? live : reel ?? live

  const maxPart = pred.appareils[0]?.part_fcfa_mois ?? 0
  const surReel = pred.source === 'reel'

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accentsoft text-accenttext">
            <Gauge size={20} strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="font-display text-lg font-extrabold text-ink">Prévision de facture</h3>
            <p className="text-xs text-muted">Par appareil, à ce rythme, sur le mois</p>
          </div>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full bg-accentsoft px-2.5 py-1 text-[11px] font-semibold text-accenttext"
          title={
            surReel
              ? 'Calculé sur les mesures réelles accumulées par le boîtier'
              : 'Projeté à la puissance actuelle des prises (mode démo)'
          }
        >
          <Sparkles size={12} strokeWidth={2.4} />
          {surReel ? 'Mesures réelles' : 'Projection live'}
        </span>
      </div>

      {/* Facture totale projetée du foyer */}
      <div className="mt-5 rounded-2xl border border-line bg-surface2 p-4">
        <p className="text-xs font-medium text-muted">Facture estimée ce mois-ci</p>
        <div className="mt-1 flex items-end gap-2">
          <span className="font-display text-3xl font-extrabold text-ink">
            <AnimatedNumber value={pred.facture_mois_projetee_fcfa} /> <span className="text-xl">FCFA</span>
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          ≈ {fmt(pred.kwh_mois_projete, 1)} kWh · {pred.bareme}
        </p>
      </div>

      {/* Classement des appareils par coût */}
      {pred.appareils.length === 0 ? (
        <p className="mt-5 text-sm text-muted">
          Aucun appareil ne consomme pour l'instant. Dès qu'une prise mesure de la consommation,
          je te dis lequel pèsera le plus sur ta facture.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {pred.appareils.map((a, i) => {
            const part = maxPart > 0 ? (a.part_fcfa_mois / maxPart) * 100 : 0
            const top = i === 0
            return (
              <li key={a.device_id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    {top && <Coins size={14} strokeWidth={2.4} className="text-accenttext" />}
                    {a.nom}
                  </span>
                  <span className="tnum shrink-0 text-muted">
                    <span className="font-semibold text-ink">{fmt(a.part_fcfa_mois)}</span> FCFA
                    <span className="ml-1.5 text-xs">· {fmt(a.kwh_mois_projete, 1)} kWh</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface2">
                  <div
                    className={
                      'h-full rounded-full transition-[width] duration-700 ease-out ' +
                      (top ? 'bg-accentline' : 'bg-line')
                    }
                    style={{ width: `${Math.max(4, part)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pred.appareil_le_plus_cher && (
        <p className="mt-5 rounded-xl bg-accentsoft px-3.5 py-2.5 text-xs text-accenttext">
          <span className="font-semibold">{pred.appareil_le_plus_cher}</span> pèsera le plus sur ta
          facture. Réduire son usage économise ~{fmt(pred.appareils[0].prix_marginal_fcfa_kwh)}{' '}
          FCFA par kWh évité.
        </p>
      )}
    </Card>
  )
}
