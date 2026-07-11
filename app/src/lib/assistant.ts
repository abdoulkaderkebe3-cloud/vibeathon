import type { CommandAction } from './ws'
import type { Device, EcoWattState, Priorite } from '../types'
import { detecter as detecterAnomalies } from './anomalie'
import { prepayeReply } from './prepaye'

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function fmt(n: number, d = 0) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: d })
}
function listeFr(noms: string[]): string {
  if (noms.length <= 1) return noms[0] ?? ''
  return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1]
}

// --- Barème CIE (miroir de backend/app/tarif_cie.py, ADR-009). À valider sur facture. ---
// Facturation bimestrielle : prime fixe + tranches. Deux barèmes selon la puissance/conso souscrite.
type Bareme = { nom: string; primeBim: number; tranches: { plafond: number; prix: number }[] }
const SOCIAL: Bareme = {
  nom: 'Tarif Social Domestique 5A',
  primeBim: 559,
  tranches: [{ plafond: 80, prix: 28.84 }, { plafond: Infinity, prix: 59.19 }],
}
const GENERAL: Bareme = {
  nom: 'Tarif Domestique Général 10A',
  primeBim: 1470.94,
  tranches: [{ plafond: 400, prix: 79.01 }, { plafond: Infinity, prix: 68.48 }],
}
// Seuil d'éligibilité au tarif social : conso moyenne ≤ 100 kWh/mois (source CIE/ANARE).
const SEUIL_SOCIAL_KWH_MOIS = 100

function coutBimestre(kwh: number, b: Bareme): number {
  let reste = Math.max(0, kwh)
  let plancher = 0
  let cout = b.primeBim
  for (const t of b.tranches) {
    if (reste <= 0) break
    const largeur = t.plafond === Infinity ? Infinity : Math.max(0, t.plafond - plancher)
    const part = Math.min(reste, largeur)
    cout += part * t.prix
    reste -= part
    plancher = t.plafond
  }
  return cout
}
function coutMensuel(kwhMois: number, b: Bareme): number {
  return coutBimestre(kwhMois * 2, b) / 2
}
function kwhPourBudgetMensuel(budgetMois: number, b: Bareme): number {
  let dispo = budgetMois * 2 - b.primeBim
  if (dispo <= 0) return 0
  let kwh = 0
  let plancher = 0
  for (const t of b.tranches) {
    const largeur = t.plafond === Infinity ? Infinity : Math.max(0, t.plafond - plancher)
    const plein = largeur * t.prix
    if (largeur !== Infinity && dispo >= plein) {
      kwh += largeur
      dispo -= plein
      plancher = t.plafond
    } else {
      kwh += dispo / t.prix
      break
    }
  }
  return kwh / 2
}
function prixMarginalMensuel(kwhMois: number, b: Bareme): number {
  const bim = kwhMois * 2
  for (const t of b.tranches) if (t.plafond === Infinity || bim < t.plafond) return t.prix
  return b.tranches[b.tranches.length - 1].prix
}
// Barème réellement applicable selon la conso mensuelle (≤ 100 kWh/mois => social, sinon général).
function baremePourConso(kwhMois: number): Bareme {
  return kwhMois <= SEUIL_SOCIAL_KWH_MOIS ? SOCIAL : GENERAL
}
// Budget FCFA -> kWh, en choisissant le barème CIE : on ne bascule au Général (plus cher) que si,
// même à ce tarif, la conso dépasse le seuil social (vrai gros consommateur). Sinon on reste social.
function kwhPourBudgetAuto(budgetMois: number): [number, Bareme] {
  const kwhS = kwhPourBudgetMensuel(budgetMois, SOCIAL)
  if (kwhS <= SEUIL_SOCIAL_KWH_MOIS) return [kwhS, SOCIAL]
  const kwhG = kwhPourBudgetMensuel(budgetMois, GENERAL)
  return kwhG > SEUIL_SOCIAL_KWH_MOIS ? [kwhG, GENERAL] : [kwhS, SOCIAL]
}
function extraireNombres(m: string): number[] {
  const compact = m.replace(/(\d)[ .](?=\d{3}\b)/g, '$1')
  return (compact.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => parseFloat(x.replace(',', '.')))
}

/** Réponse tarifaire locale. `final` = calcul chiffré exact (barème CIE) qui FAIT FOI : le LLM
 *  de la vitrine ne doit pas l'écraser. Les invites (prépayé, pas de nombre) laissent la main au LLM. */
type TarifResult = { reply: string; final: boolean }

/** Répond aux questions kWh ⇄ FCFA et à la comparaison mensuelle via le barème CIE (repli hors ligne). */
function tarifReply(m: string): TarifResult | null {
  // Compteur à carte / prépayé / durée. Si le message contient déjà les appareils, on CALCULE la durée
  // exactement (miroir Python, hors ligne) : réponse chiffrée qui FAIT FOI (le LLM ne l'écrase pas).
  // Sinon, on invite à décrire ses appareils (non final : le LLM peut mener le dialogue en vitrine).
  if (/(compteur|carte|recharg|prepay|prépay|credit|combien de temps|dure|durer|tient|tenir|jour|semaine)/.test(m)) {
    const calc = prepayeReply(m)
    if (calc) return calc
    return { final: false, reply: "Pour un compteur à carte, je peux estimer combien de temps ta recharge va durer. Dis-moi quels appareils tu utilises et environ combien d'heures par jour (ex. ventilateur 8h, télé 4h, 3 ampoules 5h, frigo en continu), et le montant que tu veux recharger." }
  }
  // Argent en MOT ENTIER : « franc(s) » ne doit pas matcher « France ». « combien » seul est trop
  // générique (« combien d'étoiles ? ») : on ne le prend plus comme signal tarifaire.
  const monnaie = /\b(fcfa|cfa|francs?)\b/.test(m)
  const estTarif = monnaie || /(kwh|kw\/h|facture|paie|paye|coute|cout|budget|consomm|depens|mois dernier|mois precedent|mois passe)/.test(m)
  if (!estTarif) return null
  const nombres = extraireNombres(m)
  // RÈGLE (choix Kader) : en Côte d'Ivoire on raisonne en argent. Le nombre est des kWh UNIQUEMENT
  // s'il est explicitement suivi de « kWh » (relevé de compteur). Sinon c'est un montant en FCFA.
  const apresKwh = /\d[\d .,]*\s*(kwh|kw ?\/ ?h)/.test(m)
  const enFcfa = !apresKwh

  const compare = /(mois dernier|mois precedent|mois passe|compare| vs |que le mois|plus que|moins que)/.test(m)
  if (compare && nombres.length >= 2) {
    const [a, b] = enFcfa
      ? [kwhPourBudgetAuto(nombres[0])[0], kwhPourBudgetAuto(nombres[1])[0]]
      : [nombres[0], nombres[1]]
    const varKwh = a - b
    const varFcfa = coutMensuel(a, baremePourConso(a)) - coutMensuel(b, baremePourConso(b))
    if (Math.abs(varKwh) < 0.01) return { final: true, reply: 'Consommation stable par rapport au mois dernier.' }
    if (varKwh > 0)
      return { final: true, reply: `Consommation en hausse : +${fmt(varKwh, 1)} kWh, soit environ +${fmt(varFcfa)} FCFA sur ta facture. Décale les usages hors des heures de pointe et coupe les veilles.` }
    return { final: true, reply: `Bravo, consommation en baisse : ${fmt(varKwh, 1)} kWh, soit environ ${fmt(varFcfa)} FCFA économisés vs le mois dernier. Continue comme ça.` }
  }

  if (!nombres.length) {
    return { final: false, reply: 'Dis-moi combien de kWh tu as consommés, ou combien tu as payé en FCFA, et je te réponds.' }
  }
  const n = nombres[0]

  if (enFcfa) {
    const [kwh, b] = kwhPourBudgetAuto(n)
    return { final: true, reply: `Avec ${fmt(n)} FCFA par mois (${b.nom}), tu peux consommer environ ${fmt(kwh)} kWh. Au-delà, chaque kWh en plus te coûte ${fmt(prixMarginalMensuel(kwh, b))} FCFA (abonnement inclus : ${fmt(b.primeBim / 2)} FCFA/mois).` }
  }

  const kwh = n
  const b = baremePourConso(kwh)
  const cout = coutMensuel(kwh, b)
  const moyen = kwh > 0 ? cout / kwh : 0
  return { final: true, reply: `Pour ${fmt(kwh)} kWh par mois (${b.nom}), ta facture serait d'environ ${fmt(cout)} FCFA (prix moyen ${fmt(moyen)} FCFA/kWh, abonnement inclus).` }
}

// Diminutifs/synonymes courants, indexés par nom d'appareil normalisé.
const ALIAS_BY_NAME: Record<string, string[]> = {
  lampe: ['lumiere', 'ampoule'],
  refrigerateur: ['frigo', 'frigidaire'],
  ventilateur: ['ventilo', 'ventil'],
  television: ['tele', 'tv', 'ecran'],
  bouilloire: ['theiere'],
  'fer a repasser': ['fer', 'repasser'],
}

function findDevice(state: EcoWattState, m: string): Device | undefined {
  const direct = state.devices.find((d) => m.includes(norm(d.nom)))
  if (direct) return direct
  return state.devices.find((d) => (ALIAS_BY_NAME[norm(d.nom)] ?? []).some((a) => m.includes(a)))
}

/** Résout la ou les cibles d'un ordre : par priorité (essentiels/reportables/confort),
 *  « tout » (avec « sauf X » optionnel), ou un appareil précis. */
function resolveTargets(state: EcoWattState, m: string): Device[] {
  const byPrio = (p: Priorite) => state.devices.filter((d) => d.priorite === p)
  if (/essentiel/.test(m)) return byPrio('essentiel')
  if (/reportable/.test(m)) return byPrio('reportable')
  if (/confort/.test(m)) return byPrio('confort')
  if (/(tout|tous|toutes)/.test(m)) {
    if (m.includes('sauf')) {
      const excl = findDevice(state, m.slice(m.indexOf('sauf')))
      return state.devices.filter((d) => d.id !== excl?.id)
    }
    return [...state.devices]
  }
  const d = findDevice(state, m)
  return d ? [d] : []
}

function actionReply(targets: Device[], state: EcoWattState, action: CommandAction): string {
  const verbe = action === 'couper' ? 'coupe' : 'rallume'
  if (targets.length === state.devices.length) return `D'accord, je ${verbe} tous les appareils.`
  const note = action === 'couper' && targets.some((d) => d.priorite === 'essentiel') ? ' (certains sont essentiels, mais tu le demandes)' : ''
  return `D'accord, je ${verbe} ${listeFr(targets.map((d) => d.nom))}${note}.`
}

export interface AssistantAction {
  nom: string
  type: CommandAction
  priorite?: Priorite
}
export interface AssistantResult {
  reply: string
  actions: AssistantAction[]
  /** true = réponse déterministe qui FAIT FOI : le LLM (vitrine) ne doit pas l'écraser. */
  final?: boolean
}

function noAction(reply: string): AssistantResult {
  return { reply, actions: [] }
}

// Réponses FIGÉES aux questions « méta » sur l'IA (quel modèle, vraie IA ou règles codées...).
// Filet jour J : identiques au backend, jamais confiées au LLM -> zéro dérapage devant le jury.
const META_NATURE = /(vraie ia|vrai ia|vraie intelligence|regles codees|regle codee|code en dur|codee en dur|un robot|es-?tu humain|une machine|un programme|un script|vraiment de l'ia|vraiment une ia|juste des regles)/
const META_MODELE = /(modele|quelle ia|quel ia|quelle intelligence|quelle techno|technologie|llm|chatgpt|gpt|openai|groq|llama|gemini|deepseek|mistral|openrouter|quel serveur|tournes sur|quel algorithme)/
const REPONSE_META_NATURE =
  "Oui, c'est bien de l'intelligence artificielle : je comprends le langage naturel, je pondère plusieurs facteurs (priorité des appareils, heure de pointe, budget, consommation réelle) pour décider quoi couper ou décaler, et j'explique chaque décision, là où un simple minuteur ne ferait qu'obéir à l'heure. Les chiffres sensibles comme le prix exact sont calculés de façon fiable, pour ne jamais t'induire en erreur."
const REPONSE_META_MODELE =
  "Je suis l'assistant IA d'EcoWatt. Ce qui compte, c'est ce que je fais pour toi : mesurer ta consommation appareil par appareil, décider quoi couper ou décaler hors des heures de pointe, prédire ta facture au barème CIE et t'expliquer chaque choix. Je préfère rester là-dessus plutôt que sur la technique."

function metaReply(m: string): string | null {
  if (META_NATURE.test(m)) return REPONSE_META_NATURE
  if (META_MODELE.test(m)) return REPONSE_META_MODELE
  return null
}

/** Assistant local (repli hors ligne) : lit l'état, répond en langage naturel et peut agir. */
export function assistantReply(message: string, state: EcoWattState): AssistantResult {
  const m = norm(message)
  // Une question n'est pas un ordre : « tu peux tout couper ? » ne doit RIEN couper (elle appelle
  // une réponse, pas une action). On neutralise les branches d'action quand le message interroge.
  const question = /\?/.test(message) || /\b(tu peux|peux-?tu|pourrais|capable|possible|est-?ce que)\b/.test(m)

  // Questions « méta » sur l'IA : réponse figée qui FAIT FOI (le LLM ne l'écrase pas en vitrine).
  const meta = metaReply(m)
  if (meta) return { reply: meta, actions: [], final: true }

  // Diagnostic / sécurité : un appareil consomme-t-il anormalement (défaut, surchauffe) ? Réponse
  // chiffrée sur l'état réel, qui FAIT FOI (le LLM ne l'écrase pas). Une alerte de sécurité prime.
  if (/(anomal|anormal|inhabituel|bizarre|probleme|souci|defaut|defectueux|en panne|verifier|chauffe|surchauff|danger|surconsom|tout va bien|rien d anormal)/.test(m)) {
    const anos = detecterAnomalies(state.devices)
    if (anos.length) return { reply: anos.map((a) => a.message).join(' '), actions: [], final: true }
    return {
      reply: "Tout est normal : aucun appareil ne consomme de façon anormale en ce moment. Je surveille en continu et je t'alerte si l'un d'eux se met à tirer trop.",
      actions: [],
      final: true,
    }
  }

  if (/(bonjour|salut|coucou|hello|bonsoir|hey)/.test(m)) {
    return noAction(
      "Bonjour ! Je suis l'assistant EcoWatt. Demande-moi quel appareil consomme le plus, pourquoi j'ai coupé quelque chose, ton bilan d'économies, ou donne-moi un ordre comme « coupe la bouilloire ».",
    )
  }

  // Questions tarifaires (kWh ⇄ FCFA, comparaison mensuelle) : réponse chiffrée exacte via le barème CIE.
  // Placé avant la règle « bilan » qui capte aussi « kwh »/« facture ». Un calcul chiffré FAIT FOI
  // (final) pour que le LLM de la vitrine ne l'écrase pas ; l'invite prépayé laisse la main au LLM.
  const tarif = tarifReply(m)
  if (tarif) return { reply: tarif.reply, actions: [], final: tarif.final }

  if (/(consomme le plus|plus gros|gros conso|plus de conso|gourmand)/.test(m)) {
    const on = state.devices.filter((d) => d.etat === 'on')
    if (!on.length) return noAction("Aucun appareil n'est allumé pour l'instant.")
    const top = on.reduce((a, b) => (b.conso_w > a.conso_w ? b : a))
    return noAction(`L'appareil le plus gourmand en ce moment est ${top.nom}, avec ${fmt(top.conso_w)} W.`)
  }

  if (/(appareil|prise)/.test(m) && /(combien|nombre|compte)/.test(m)) {
    const actifs = state.devices.filter((d) => d.etat === 'on').length
    return noAction(`Tu as ${state.devices.length} appareils connectés, dont ${actifs} allumés.`)
  }

  if (/(econom|impact|kwh|co2|facture|gaspill|bilan)/.test(m)) {
    return noAction(
      `Jusqu'ici, EcoWatt a évité ${fmt(state.impact.kwh_evites, 2)} kWh, soit ${fmt(state.impact.fcfa_economises)} FCFA et ${fmt(state.impact.co2_evite_kg, 2)} kg de CO2.`,
    )
  }

  if (/(pourquoi|explique|raison)/.test(m)) {
    const last = state.decisions[0]
    return noAction(last ? `Ma dernière décision : ${last.raison}` : "Je n'ai pas encore pris de décision.")
  }

  if (!question && /(coupe|eteins|eteindre|arrete|stop)/.test(m)) {
    const targets = resolveTargets(state, m)
    if (targets.length) {
      return { reply: actionReply(targets, state, 'couper'), actions: targets.map((d) => ({ nom: d.nom, type: 'couper' })) }
    }
    return noAction('Quel appareil veux-tu que je coupe ? Par exemple : « coupe la bouilloire » ou « éteins tout ».')
  }

  if (!question && /(allume|rallume|remets|active)/.test(m)) {
    const targets = resolveTargets(state, m)
    if (targets.length) {
      return { reply: actionReply(targets, state, 'rallumer'), actions: targets.map((d) => ({ nom: d.nom, type: 'rallumer' })) }
    }
    return noAction('Quel appareil veux-tu rallumer ? Par exemple : « rallume la lampe » ou « rallume tout ».')
  }

  // Reclassement de priorité : « mets la télé en essentiel », « classe le fer en reportable ».
  const prio = m.match(/\b(essentiel|reportable|confort)\b/)
  if (!question && prio && /(mets|met |classe|marque|considere|definis|definir|passe|range|reclasse|priorite)/.test(m)) {
    const d = findDevice(state, m)
    const p = prio[1] as Priorite
    if (d) {
      const note = p === 'essentiel' ? ' Je ne le couperai plus automatiquement, même en heure de pointe.' : ''
      return { reply: `C'est noté, ${d.nom} est maintenant classé « ${p} ».${note}`, actions: [{ nom: d.nom, type: 'priorite', priorite: p }] }
    }
    return noAction(`Quel appareil veux-tu classer « ${p} » ? Par exemple : « mets la télévision en essentiel ».`)
  }

  if (/(priorit|essentiel|douche|chaud|reporte|reportable)/.test(m) || /a \d{1,2}\s?h/.test(m)) {
    return noAction(
      'Compris, je tiens compte de cette préférence pour mes prochaines décisions. Je ne couperai jamais ce que tu marques comme essentiel, et je décalerai plutôt les usages reportables hors des heures de pointe.',
    )
  }

  if (/(c'?est quoi ecowatt|qu'?est.?ce.*ecowatt|presente|explique ecowatt|comment ca marche|comment tu fonctionne|comment tu marche)/.test(m)) {
    return noAction(
      "EcoWatt est un réseau de prises intelligentes piloté par IA. Chaque prise mesure la consommation réelle d'un appareil et peut le couper. Je reçois toutes les mesures et je décide quoi couper ou décaler hors des heures de pointe, en pondérant la priorité de l'appareil, le moment, ton budget et la consommation. Le tout réduit ta facture et le CO2.",
    )
  }

  if (/(aide|help|que peux.?tu|tu sais faire|tes fonction|a quoi tu sers)/.test(m)) {
    return noAction(
      "Je peux : t'expliquer EcoWatt et comment je décide, te dire quel appareil consomme le plus, justifier mes coupures, donner ton bilan d'économies (kWh, FCFA, CO2), lister l'état du foyer, et exécuter tes ordres (couper/rallumer un ou plusieurs appareils, y compris par groupe : « allume les essentiels »).",
    )
  }

  if (/(conseil|astuce|comment econom|reduire|baisser.*facture|moins consommer)/.test(m)) {
    return noAction(
      "Trois leviers efficaces : décaler les gros appareils (chauffe-eau, fer, machine) hors des heures de pointe, couper les appareils en veille qui consomment pour rien, et marquer comme reportable tout ce qui n'est pas vital. Je m'en occupe automatiquement, mais tu peux aussi me donner des consignes.",
    )
  }

  if (/(heure de pointe|heures pleines|heures creuses|pointe)/.test(m)) {
    return noAction(
      "Les heures de pointe sont les moments où tout le monde consomme en même temps : le réseau est saturé et l'électricité la plus polluante. J'y déleste en priorité les appareils reportables, puis je les rallume en heures creuses. Par défaut, la pointe est configurée de 18h à 22h.",
    )
  }

  if (/(etat|status|appareils|liste|actif)/.test(m)) {
    const lines = state.devices
      .map((d) => `• ${d.nom} : ${d.etat === 'on' ? fmt(d.conso_w) + ' W' : 'coupé'} (${d.priorite})`)
      .join('\n')
    return noAction(`Voici l'état actuel du foyer :\n${lines}`)
  }

  return noAction(
    "Je peux t'aider à : voir quel appareil consomme le plus, expliquer mes décisions, te donner ton bilan d'économies, ou couper/rallumer un ou plusieurs appareils. Dis-moi ce que tu veux.",
  )
}
