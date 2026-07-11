// Prédiction de facture PAR APPAREIL côté front.
//
// Deux sources, mêmes données de sortie (le composant PredictionCard est agnostique) :
//  - RÉEL  : on interroge le backend `GET /api/predictions`, qui prédit sur les VRAIES
//            mesures accumulées du boîtier (énergie kWh intégrée sur plusieurs jours).
//  - DÉMO  : pas de mesures accumulées -> on projette « à la puissance actuelle » depuis
//            les watts live du simulateur (offline, garanti le jour J). Barème CIE en miroir.
//
// Le barème est le miroir fidèle de backend/app/tarif_cie.py (ADR-009) : social ≤ 100 kWh/mois,
// général au-delà, prime fixe incluse. À valider sur facture réelle (🟡 comme côté backend).

import type { Device } from '../types'

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/app'
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? WS_URL.replace(/^ws/, 'http').replace(/\/ws\/app$/, '')

// --- Barèmes CIE (miroir de tarif_cie.py) ------------------------------------------------ //
interface Tranche {
  plafond: number // kWh/bimestre ; Infinity = tranche finale
  prix: number // FCFA/kWh
}
export interface Bareme {
  nom: string
  primeFixeBim: number
  tranches: Tranche[]
}

const TARIF_SOCIAL: Bareme = {
  nom: 'Tarif Social Domestique 5A',
  primeFixeBim: 559,
  tranches: [
    { plafond: 80, prix: 28.84 },
    { plafond: Infinity, prix: 59.19 },
  ],
}
const TARIF_GENERAL: Bareme = {
  nom: 'Tarif Domestique Général 10A',
  primeFixeBim: 1470.94,
  tranches: [
    { plafond: 400, prix: 79.01 },
    { plafond: Infinity, prix: 68.48 },
  ],
}
const SEUIL_SOCIAL_KWH_MOIS = 100

export function baremePourConsoMensuelle(kwhMois: number): Bareme {
  return kwhMois <= SEUIL_SOCIAL_KWH_MOIS ? TARIF_SOCIAL : TARIF_GENERAL
}

function coutBimestre(kwh: number, bareme: Bareme): number {
  let reste = Math.max(0, kwh)
  let plancher = 0
  let cout = bareme.primeFixeBim
  for (const t of bareme.tranches) {
    if (reste <= 0) break
    const largeur = t.plafond === Infinity ? Infinity : Math.max(0, t.plafond - plancher)
    const part = Math.min(reste, largeur)
    cout += part * t.prix
    reste -= part
    plancher = t.plafond
  }
  return cout
}

export function coutMensuel(kwhMois: number, bareme: Bareme): number {
  return coutBimestre(kwhMois * 2, bareme) / 2
}

function prixMarginalMensuel(kwhMois: number, bareme: Bareme): number {
  const bim = kwhMois * 2
  for (const t of bareme.tranches) if (t.plafond === Infinity || bim < t.plafond) return t.prix
  return bareme.tranches[bareme.tranches.length - 1].prix
}

/**
 * Prix (FCFA) du prochain kWh évité au barème CIE, pour le niveau de conso actuel du foyer.
 * Source de vérité UNIQUE du prix du kWh côté front (cohérence économies ⇄ facture, ADR-009) :
 * la carte « Impact / Économies » valorise l'énergie évitée à ce même prix marginal, plus au
 * prix unique de 79 FCFA codé en dur. Miroir de backend `_prix_marginal_pour_watts`.
 */
export function prixMarginalDepuisDevices(devices: Device[]): number {
  const kwhMois = devices
    .filter((d) => d.etat === 'on' && d.conso_w > 0)
    .reduce((s, d) => s + ((d.conso_w * 24) / 1000) * 30, 0)
  const bareme = baremePourConsoMensuelle(kwhMois)
  return prixMarginalMensuel(kwhMois, bareme)
}

// --- Forme de sortie (identique au JSON de /api/predictions) ------------------------------ //
export interface ProjectionAppareil {
  device_id: string
  nom: string
  kwh_jour_observe: number
  kwh_jour_prevu: number
  kwh_mois_projete: number
  part_fcfa_mois: number
  prix_marginal_fcfa_kwh: number
  fiabilite_pct: number | null
  jours_donnees: number
}

export interface PredictionFoyer {
  appareils: ProjectionAppareil[]
  kwh_jour_total: number
  kwh_mois_projete: number
  facture_mois_projetee_fcfa: number
  bareme: string
  appareil_le_plus_cher: string | null
  message: string
  source: 'reel' | 'demo'
}

/** Projection « à la puissance actuelle » depuis les watts live (mode démo, offline). */
export function predireDepuisDevices(devices: Device[]): PredictionFoyer {
  const actifs = devices.filter((d) => d.etat === 'on' && d.conso_w > 0)
  const parAppareil = actifs.map((d) => {
    const kwhJour = (d.conso_w * 24) / 1000
    return { d, kwhJour, kwhMois: kwhJour * 30 }
  })
  const kwhMoisTotal = parAppareil.reduce((s, a) => s + a.kwhMois, 0)
  const kwhJourTotal = parAppareil.reduce((s, a) => s + a.kwhJour, 0)
  const bareme = baremePourConsoMensuelle(kwhMoisTotal)
  const factureTotale = coutMensuel(kwhMoisTotal, bareme)
  const prixMarginal = prixMarginalMensuel(kwhMoisTotal, bareme)

  const appareils: ProjectionAppareil[] = parAppareil
    .map(({ d, kwhJour, kwhMois }) => ({
      device_id: d.id,
      nom: d.nom,
      kwh_jour_observe: +kwhJour.toFixed(3),
      kwh_jour_prevu: +kwhJour.toFixed(3),
      kwh_mois_projete: +kwhMois.toFixed(2),
      part_fcfa_mois: kwhMoisTotal > 0 ? +(factureTotale * (kwhMois / kwhMoisTotal)).toFixed(2) : 0,
      prix_marginal_fcfa_kwh: +prixMarginal.toFixed(2),
      fiabilite_pct: null,
      jours_donnees: 0,
    }))
    .sort((a, b) => b.part_fcfa_mois - a.part_fcfa_mois)

  const plusCher = appareils[0] ?? null
  return {
    appareils,
    kwh_jour_total: +kwhJourTotal.toFixed(3),
    kwh_mois_projete: +kwhMoisTotal.toFixed(2),
    facture_mois_projetee_fcfa: +factureTotale.toFixed(2),
    bareme: bareme.nom,
    appareil_le_plus_cher: plusCher?.nom ?? null,
    message: '',
    source: 'demo',
  }
}

/** Récupère la prédiction du backend (mesures réelles). null si indisponible/vide. */
export async function fetchPredictionsReel(signal?: AbortSignal): Promise<PredictionFoyer | null> {
  try {
    const r = await fetch(`${API_BASE}/api/predictions`, { signal })
    if (!r.ok) return null
    const data = (await r.json()) as Omit<PredictionFoyer, 'source'>
    if (!data.appareil_le_plus_cher) return null // pas encore de mesures réelles
    return { ...data, source: 'reel' }
  } catch {
    return null // backend injoignable
  }
}
