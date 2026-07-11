import { describe, expect, it } from 'vitest'
import { parseAppareils, parseMontantFcfa, prepayeReply } from './prepaye'

describe('prépayé — calcul exact hors ligne (miroir du backend)', () => {
  const scenario = '1000 FCFA sur mon compteur : ventilateur 8h, télé 4h, 3 ampoules 5h, frigo en continu. Ça dure ?'

  it('parse les appareils, heures et quantités', () => {
    const a = parseAppareils(scenario)
    expect(a).not.toBeNull()
    const noms = a!.map((x) => x.nom)
    expect(noms).toContain('ventilateur')
    expect(noms).toContain('television')
    expect(noms).toContain('ampoule')
    expect(noms).toContain('refrigerateur')
    expect(a!.find((x) => x.nom === 'ampoule')!.quantite).toBe(3)
    expect(a!.find((x) => x.nom === 'refrigerateur')!.heures).toBe(24) // cyclique
  })

  it('extrait le montant de la recharge', () => {
    expect(parseMontantFcfa(scenario)).toBe(1000)
  })

  it('calcule la durée exacte (~6,6 jours) et fait foi (final)', () => {
    const r = prepayeReply(scenario)
    expect(r).not.toBeNull()
    expect(r!.final).toBe(true)
    expect(r!.reply).toContain('6,6 jours')
    expect(r!.reply).toContain('Tarif Social')
    expect(r!.reply).toContain('kWh par jour')
  })

  it('sans appareils exploitables, ne calcule pas (le LLM / l\'invite prend le relais)', () => {
    expect(prepayeReply('mon compteur à carte, ça dure combien ?')).toBeNull()
  })
})
