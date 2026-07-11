import { describe, expect, it } from 'vitest'
import { assistantReply } from './assistant'
import type { EcoWattState } from '../types'

const state: EcoWattState = {
  devices: [
    { id: 'lamp-1', nom: 'Lampe', prise_id: 'p1', priorite: 'essentiel', etat: 'on', conso_w: 40, replanifie_a: null },
    { id: 'kettle-1', nom: 'Bouilloire', prise_id: 'p2', priorite: 'reportable', etat: 'on', conso_w: 1500, replanifie_a: null },
  ],
  decisions: [],
  impact: { kwh_evites: 2, fcfa_economises: 130, co2_evite_kg: 1 },
  impact_projection_10000: { kwh_evites: 0, fcfa_economises: 0, co2_evite_kg: 0 },
  mock: true,
  peak_now: true,
  ts: new Date().toISOString(),
}

describe('assistantReply — cohérence (pas de faux positifs)', () => {
  it('une question ne déclenche AUCUNE action (« tu peux tout couper ? »)', () => {
    const r = assistantReply('tu peux tout couper ?', state)
    expect(r.actions).toHaveLength(0)
  })

  it('un ordre impératif agit bien (« coupe tout »)', () => {
    const r = assistantReply('coupe tout', state)
    expect(r.actions.length).toBe(state.devices.length)
    expect(r.actions.every((a) => a.type === 'couper')).toBe(true)
  })

  it('« la France » ne déclenche pas la réponse tarifaire', () => {
    const r = assistantReply('quelle est la capitale de la France ?', state)
    expect(r.reply).not.toContain('kWh tu as consommés')
    expect(r.reply).not.toContain('combien tu as payé')
    expect(r.actions).toHaveLength(0)
  })

  it('une vraie question tarifaire répond toujours (« 120 kWh ça fait combien ? »)', () => {
    const r = assistantReply('120 kWh ça fait combien ?', state)
    expect(r.reply).toContain('FCFA')
  })

  it('un montant nu est compris comme des FCFA, pas des kWh (« consommé 20000, combien de kWh ? »)', () => {
    const r = assistantReply("le mois passe j'ai consomme 20000 c'est combien de kwh", state)
    expect(r.reply).toContain('FCFA par mois')
    expect(r.reply).toContain('251 kWh') // ~251 kWh au Tarif Général CIE (montant lu comme des FCFA)
  })

  it('« payé/facture X » = un montant en FCFA (pas une facture d\'un million)', () => {
    const r = assistantReply("j'ai paye 15000 le mois dernier", state)
    expect(r.reply).toContain('FCFA par mois')
    expect(r.reply).not.toContain('1030041')
  })

  it('un gros budget bascule au Tarif Général, un petit reste au Social', () => {
    expect(assistantReply('50000 combien de kwh', state).reply).toContain('Général')
    expect(assistantReply('avec 5000 fcfa combien de kwh', state).reply).toContain('Social')
  })

  it('un calcul tarifaire chiffré FAIT FOI (final) : le LLM de la vitrine ne l\'écrase pas', () => {
    const r = assistantReply('20000 fcfa combien de kwh', state)
    expect(r.final).toBe(true)
  })

  it('« quel modèle ? » : réponse figée, autoritaire, sans fuite du fournisseur', () => {
    const r = assistantReply('quel modèle dIA utilises-tu ?', state)
    expect(r.final).toBe(true)
    expect(r.reply).toContain('EcoWatt')
    expect(r.reply.toLowerCase()).not.toMatch(/groq|llama|deepseek|openrouter|gpt|gemini/)
  })

  it('« es-tu une vraie IA ou des règles codées ? » : affirme l\'IA, sans aveu', () => {
    const r = assistantReply('es-tu une vraie IA ou juste des regles codees ?', state)
    expect(r.final).toBe(true)
    expect(r.reply).toContain('intelligence artificielle')
  })

  it('diagnostic : signale un appareil en surconsommation (réponse qui fait foi)', () => {
    const anormal: EcoWattState = {
      ...state,
      devices: [{ id: 'f1', nom: 'Réfrigérateur', prise_id: 'p', priorite: 'essentiel', etat: 'on', conso_w: 600, replanifie_a: null }],
    }
    const r = assistantReply('est-ce quun appareil consomme anormalement ?', anormal)
    expect(r.final).toBe(true)
    expect(r.reply).toContain('Réfrigérateur')
    expect(r.reply.toLowerCase()).toContain('vérifier')
  })

  it('diagnostic : rien d’anormal quand tout va bien', () => {
    const r = assistantReply('tout va bien avec mes appareils ?', state)
    expect(r.final).toBe(true)
    expect(r.reply.toLowerCase()).toContain('normal')
  })
})
