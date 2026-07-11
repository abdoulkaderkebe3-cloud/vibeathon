// Détection d'anomalie de consommation (miroir de backend/app/anomalie.py).
// Un appareil qui tire bien au-dessus de la normale de son type = défaut probable (moteur,
// résistance, câblage) -> risque de surchauffe. Fonction PURE des watts + type : calculée à
// l'affichage, sans toucher au contrat Device ni au backend. Marche en démo comme en réel.
import type { Device } from '../types'

// Puissance (W) au-delà de laquelle, pour ce type, la conso est jugée anormale (~2-3× la normale).
const SEUIL_W: Record<string, number> = {
  'ampoule led': 40, ampoule: 150, ventilateur: 160, television: 300,
  decodeur: 60, climatiseur: 2000, 'fer a repasser': 2200, bouilloire: 2600,
  chargeur: 40, ordinateur: 250, 'machine a laver': 3000, 'pompe a eau': 1600,
  refrigerateur: 400, congelateur: 500,
}
const NORMALE_W: Record<string, number> = {
  'ampoule led': 10, ampoule: 60, ventilateur: 60, television: 120,
  decodeur: 15, climatiseur: 900, 'fer a repasser': 1000, bouilloire: 1500,
  chargeur: 5, ordinateur: 60, 'machine a laver': 500, 'pompe a eau': 750,
  refrigerateur: 150, congelateur: 200,
}
// Alias (texte normalisé sans accent) -> type canonique. Aligné sur prediction.ALIAS (backend).
const ALIAS: Record<string, string[]> = {
  'ampoule led': ['ampoule led', 'ampoules led', 'lampe led', 'led'],
  ampoule: ['ampoule', 'ampoules', 'lampe', 'lampes', 'lumiere'],
  ventilateur: ['ventilateur', 'ventilo', 'ventil'],
  television: ['television', 'televiseur', 'tele', 'tv', 'ecran'],
  decodeur: ['decodeur', 'canal', 'tnt'],
  climatiseur: ['climatiseur', 'climatisation', 'clim', 'split'],
  'fer a repasser': ['fer a repasser', 'fer', 'repasser'],
  bouilloire: ['bouilloire', 'theiere'],
  chargeur: ['chargeur'],
  ordinateur: ['ordinateur', 'ordi', 'pc', 'laptop'],
  'machine a laver': ['machine a laver', 'lave linge', 'lave-linge', 'machine'],
  'pompe a eau': ['pompe a eau', 'pompe'],
  refrigerateur: ['refrigerateur', 'frigo', 'frigidaire', 'refregirateur'],
  congelateur: ['congelateur', 'congel', 'congelo'],
}

function sansAccent(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function typeAppareil(nom: string): string | null {
  const n = sansAccent(nom)
  let meilleur: string | null = null
  let longueur = 0
  for (const [canon, aliases] of Object.entries(ALIAS)) {
    for (const a of aliases) {
      if (n.includes(a) && a.length > longueur) {
        meilleur = canon
        longueur = a.length
      }
    }
  }
  return meilleur
}

export interface Anomalie {
  device_id: string
  nom: string
  watts: number
  normaleW: number
  message: string
}

/** Anomalie si l'appareil est allumé et tire nettement plus que la normale de son type, sinon null. */
export function anomalieDe(d: Device): Anomalie | null {
  if (d.etat !== 'on') return null
  const canon = typeAppareil(d.nom)
  if (!canon || !(canon in SEUIL_W)) return null
  const watts = d.conso_w || 0
  if (watts <= SEUIL_W[canon]) return null
  const normaleW = NORMALE_W[canon] ?? SEUIL_W[canon] / 2
  const message = `⚠️ ${d.nom} tire ${Math.round(watts)} W, bien au-dessus de la normale (~${Math.round(normaleW)} W). Ça peut venir d'un défaut (moteur, résistance ou câblage) : fais-le vérifier, et coupe-le en cas de doute (risque de surchauffe).`
  return { device_id: d.id, nom: d.nom, watts: Math.round(watts), normaleW, message }
}

/** true si l'appareil consomme anormalement (pour le badge d'alerte du dashboard). */
export function estAnormal(d: Device): boolean {
  return anomalieDe(d) !== null
}

/** Conso « de régime normal » pour la PRÉVISION DE FACTURE : un pic anormal (défaut transitoire) est
 *  ramené à la normale du type pour ne pas gonfler la facture du mois. Éteint -> 0 ; type inconnu ->
 *  conso brute. Ainsi la facture estimée reste cohérente même quand un appareil déraille un instant. */
export function consoStable(d: Device): number {
  if (d.etat !== 'on') return 0
  const w = d.conso_w || 0
  const canon = typeAppareil(d.nom)
  if (canon && canon in SEUIL_W && w > SEUIL_W[canon]) return NORMALE_W[canon] ?? SEUIL_W[canon] / 2
  return w
}

export function detecter(devices: Device[]): Anomalie[] {
  return devices.map(anomalieDe).filter((a): a is Anomalie => a !== null)
}
