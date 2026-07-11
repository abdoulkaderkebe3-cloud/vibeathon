import { describe, expect, it } from 'vitest'
import { predireDepuisDevices } from './predictions'
import type { Device } from '../types'

// Fabrique un appareil minimal allumé à `watts`.
function dev(id: string, nom: string, watts: number, etat: Device['etat'] = 'on'): Device {
  return { id, nom, prise_id: id, priorite: 'confort', etat, conso_w: watts, replanifie_a: null }
}

// kWh/mois d'un appareil constant : watts * 24h / 1000 * 30j = watts * 0.72.
const wattsPourKwhMois = (kwh: number) => kwh / 0.72

describe('predireDepuisDevices — barème CIE (miroir de tarif_cie.py)', () => {
  it('ancre sur le backend : 100 kWh/mois ≈ 4985 FCFA au Tarif Social', () => {
    const p = predireDepuisDevices([dev('a', 'Appareil', wattsPourKwhMois(100))])
    expect(p.kwh_mois_projete).toBeCloseTo(100, 1)
    expect(p.facture_mois_projetee_fcfa).toBeGreaterThan(4900)
    expect(p.facture_mois_projetee_fcfa).toBeLessThan(5070)
    expect(p.bareme).toContain('Social')
  })

  it('bascule au Tarif Général au-delà de 100 kWh/mois', () => {
    const social = predireDepuisDevices([dev('a', 'A', wattsPourKwhMois(90))])
    const general = predireDepuisDevices([dev('a', 'A', wattsPourKwhMois(130))])
    expect(social.bareme).toContain('Social')
    expect(general.bareme).toContain('Général')
  })

  it('le classement des appareils est trié par coût décroissant et somme à la facture foyer', () => {
    const p = predireDepuisDevices([
      dev('clim', 'Climatiseur', 900),
      dev('lampe', 'Lampe', 40),
      dev('tv', 'Télévision', 120),
    ])
    // trié par part de facture décroissante
    const parts = p.appareils.map((a) => a.part_fcfa_mois)
    expect(parts).toEqual([...parts].sort((x, y) => y - x))
    expect(p.appareil_le_plus_cher).toBe('Climatiseur')
    // la répartition par appareil somme (à l'arrondi près) à la facture du foyer
    const somme = p.appareils.reduce((s, a) => s + a.part_fcfa_mois, 0)
    expect(somme).toBeCloseTo(p.facture_mois_projetee_fcfa, 0)
  })

  it('ignore les appareils éteints ou à 0 W', () => {
    const p = predireDepuisDevices([
      dev('on', 'Actif', 100),
      dev('off', 'Éteint', 100, 'off'),
      dev('zero', 'Zéro', 0),
    ])
    expect(p.appareils).toHaveLength(1)
    expect(p.appareils[0].nom).toBe('Actif')
  })

  it('foyer sans appareil actif : pas de plantage, aucun appareil', () => {
    const p = predireDepuisDevices([dev('off', 'Éteint', 0, 'off')])
    expect(p.appareils).toHaveLength(0)
    expect(p.appareil_le_plus_cher).toBeNull()
    expect(p.source).toBe('demo')
  })
})
