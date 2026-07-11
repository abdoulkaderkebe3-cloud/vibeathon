// Prépayé / compteur à carte : calcul EXACT de la durée d'une recharge, hors ligne (miroir de
// backend/app/prediction.predire_prepaye). Sur la vitrine, le LLM refuse d'inventer un chiffre :
// ce module donne la vraie réponse (« ~9,4 jours ») sans backend, en un seul message.
import { baremePourConsoMensuelle, coutMensuel } from './predictions'
import { typeAppareil } from './anomalie'

// Puissance moyenne (W) par type (miroir de prediction.PUISSANCES_W). 0 = cyclique (voir ci-dessous).
const PUISSANCES_W: Record<string, number> = {
  'ampoule led': 10, ampoule: 60, ventilateur: 60, television: 100,
  decodeur: 15, climatiseur: 900, 'fer a repasser': 1000, bouilloire: 1500,
  chargeur: 5, ordinateur: 50, 'machine a laver': 500, 'pompe a eau': 750,
  refrigerateur: 0, congelateur: 0,
}
// Appareils cycliques (compresseur) : kWh/jour direct, on ignore les heures d'usage.
const KWH_JOUR_CYCLIQUE: Record<string, number> = { refrigerateur: 1.3, congelateur: 2.0 }

// Libellés (singulier, pluriel) pour un message propre.
const LIBELLES: Record<string, [string, string]> = {
  'ampoule led': ['ampoule LED', 'ampoules LED'], ampoule: ['ampoule', 'ampoules'],
  ventilateur: ['ventilateur', 'ventilateurs'], television: ['télévision', 'télévisions'],
  decodeur: ['décodeur', 'décodeurs'], climatiseur: ['climatiseur', 'climatiseurs'],
  'fer a repasser': ['fer à repasser', 'fers à repasser'], bouilloire: ['bouilloire', 'bouilloires'],
  chargeur: ['chargeur', 'chargeurs'], ordinateur: ['ordinateur', 'ordinateurs'],
  'machine a laver': ['machine à laver', 'machines à laver'], 'pompe a eau': ['pompe à eau', 'pompes à eau'],
  refrigerateur: ['réfrigérateur', 'réfrigérateurs'], congelateur: ['congélateur', 'congélateurs'],
}
const MOTS_NOMBRES: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function libelle(nom: string, quantite = 1): string {
  const [sing, plur] = LIBELLES[nom] ?? [nom, nom]
  return quantite > 1 ? plur : sing
}
function fmt(n: number, d = 0): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function kwhJour(nom: string, heures: number, quantite: number): number {
  if (nom in KWH_JOUR_CYCLIQUE) return KWH_JOUR_CYCLIQUE[nom] * quantite
  return ((PUISSANCES_W[nom] ?? 0) * heures * quantite) / 1000
}
// Coût journalier réel : même grille que le postpayé, PRIME FIXE INCLUSE, barème selon la conso.
function fcfaJour(kwhJourTotal: number): number {
  const kwhMois = kwhJourTotal * 30
  return coutMensuel(kwhMois, baremePourConsoMensuelle(kwhMois)) / 30
}

// --- Parsing langage naturel (miroir de main._parse_appareils / _parse_montant_fcfa) ---

function heuresDuSegment(seg: string, canon: string): number | null {
  if (canon in KWH_JOUR_CYCLIQUE) return 24
  if (/(continu|toute la journee|jour et nuit|24 ?h)/.test(seg)) return 24
  const mh = seg.match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|heure)/)
  if (mh) return parseFloat(mh[1].replace(',', '.'))
  for (const [mot, val] of Object.entries(MOTS_NOMBRES)) {
    if (new RegExp(`\\b${mot}\\b\\s*heure`).test(seg)) return val
  }
  return null
}
function quantiteDuSegment(seg: string): number {
  const md = seg.match(/^\s*(\d+)/)
  if (md) {
    const suite = seg.slice(md[0].length)
    // Un nombre suivi de « h/heure » = durée, suivi de « fcfa/cfa/franc » = montant : pas une quantité.
    if (!/^\s*(?:h\b|heure)/.test(suite) && !/^\s*(?:fcfa|francs?|cfa)/.test(suite)) return parseInt(md[1], 10)
  }
  for (const [mot, val] of Object.entries(MOTS_NOMBRES)) {
    if (new RegExp(`\\b${mot}\\b`).test(seg)) return val
  }
  return 1
}

export type AppareilSaisi = { nom: string; heures: number; quantite: number }

/** [(nom, heures, quantite)] extrait du message. null si un appareil non cyclique n'a pas d'heures. */
export function parseAppareils(message: string): AppareilSaisi[] | null {
  const m = norm(message)
  const segments = m.split(/[,;/]|\bet\b|\bplus\b|\bainsi que\b/)
  const out: AppareilSaisi[] = []
  for (const seg of segments) {
    const canon = typeAppareil(seg)
    if (!canon) continue
    const heures = heuresDuSegment(seg, canon)
    if (heures === null) return null // appareil sans durée => parse non fiable
    out.push({ nom: canon, heures, quantite: quantiteDuSegment(seg) })
  }
  return out.length ? out : null
}

export function parseMontantFcfa(texte: string): number | null {
  const m = norm(texte)
  const cands: string[] = []
  for (const re of [/(\d[\d .]*\d|\d+)\s*(?:fcfa|francs?|cfa)/g, /recharg\w*\s*(?:de\s*)?(\d[\d .]*\d|\d+)/g, /(?:mets?|mettre|met)\s*(\d[\d .]*\d|\d+)/g]) {
    for (const match of m.matchAll(re)) cands.push(match[1])
  }
  const valeurs = cands.map((c) => parseFloat(c.replace(/[ .]/g, ''))).filter((v) => v >= 100)
  return valeurs.length ? valeurs[valeurs.length - 1] : null
}

// --- Calcul + message (miroir de prediction.predire_prepaye) ---

export function predirePrepaye(appareils: AppareilSaisi[], montant: number | null): string {
  const lignes = appareils.map((a) => {
    const q = Math.max(1, Math.round(a.quantite))
    return { nom: a.nom, quantite: q, puissanceW: PUISSANCES_W[a.nom] ?? 0, heures: a.heures, kwhJour: kwhJour(a.nom, a.heures, q) }
  })
  const kwhJourTotal = lignes.reduce((s, l) => s + l.kwhJour, 0)
  const fj = fcfaJour(kwhJourTotal)
  const jours = montant && fj > 0 ? montant / fj : null

  // Conseils chiffrés exacts : réduire les 2 plus gros postes non cycliques de 2 h/jour.
  const conseils: string[] = []
  if (montant && fj > 0) {
    const modulables = lignes
      .filter((l) => !(l.nom in KWH_JOUR_CYCLIQUE) && l.heures >= 2)
      .sort((a, b) => b.kwhJour - a.kwhJour)
    for (const l of modulables.slice(0, 2)) {
      const gainKwh = (l.puissanceW * 2 * l.quantite) / 1000
      const fjApres = fcfaJour(Math.max(0, kwhJourTotal - gainKwh))
      const joursApres = fjApres > 0 ? montant / fjApres : jours
      const gagnes = joursApres && jours ? joursApres - jours : 0
      if (gagnes >= 0.3) conseils.push(`2 h de ${libelle(l.nom)} en moins par jour (+${fmt(gagnes, 1)} j)`)
    }
  }

  const detail = lignes
    .map((l) => (l.quantite > 1 ? `${l.quantite} ` : '') + libelle(l.nom, l.quantite)
      + (l.nom in KWH_JOUR_CYCLIQUE ? ' en continu' : ` ${fmt(l.heures)} h`)
      + ` → ${fmt(l.kwhJour, 2)} kWh/j`)
    .join(', ')
  const tarifNom = baremePourConsoMensuelle(kwhJourTotal * 30).nom
  let msg = `D'après tes appareils (${detail}), tu consommes environ ${fmt(kwhJourTotal, 2)} kWh par jour, `
    + `soit à peu près ${fmt(fj)} FCFA/jour (${tarifNom}, prime fixe incluse).`
  if (jours !== null && montant) {
    msg += ` Ta recharge de ${fmt(montant)} FCFA devrait durer environ ${fmt(jours, 1)} jours.`
    if (conseils.length) msg += ` Pour l'étirer : ${conseils.join(' ; ')}.`
  } else {
    msg += ' Dis-moi combien tu veux recharger (en FCFA) et je te dis combien de temps ça tient.'
  }
  return msg
}

/** Réponse prépayée EXACTE si le message contient des appareils exploitables en contexte prépayé.
 *  null sinon (l'invite / le LLM prend alors le relais). `final` = calcul chiffré, non écrasé par le LLM. */
export function prepayeReply(message: string): { reply: string; final: boolean } | null {
  const appareils = parseAppareils(message)
  if (!appareils) return null
  const m = norm(message)
  const contextePrepaye = /(compteur|carte|recharg|prepay|credit|combien de temps|dure|tient|jour|fcfa|franc|cfa)/.test(m)
  if (!contextePrepaye) return null
  const montant = parseMontantFcfa(message)
  return { reply: predirePrepaye(appareils, montant), final: true }
}
