import { describe, expect, it } from 'vitest'
import { anomalieDe, consoStable, detecter, estAnormal } from './anomalie'
import type { Device } from '../types'

function dev(nom: string, conso_w: number, etat: 'on' | 'off' = 'on'): Device {
  return { id: 'x', nom, prise_id: 'p', priorite: 'confort', etat, conso_w, replanifie_a: null }
}

describe('détection d’anomalie de consommation', () => {
  it('un appareil normal n’est pas signalé', () => {
    expect(estAnormal(dev('Réfrigérateur', 160))).toBe(false)
    expect(estAnormal(dev('Lampe', 45))).toBe(false)
  })

  it('une surconsommation est détectée avec un message clair', () => {
    const a = anomalieDe(dev('Réfrigérateur', 620))
    expect(a).not.toBeNull()
    expect(a!.message).toContain('vérifier')
    expect(a!.message).toContain('620')
  })

  it('le seuil dépend du type (fer 1200 W = ok, frigo 1200 W = anormal)', () => {
    expect(estAnormal(dev('Fer à repasser', 1200))).toBe(false)
    expect(estAnormal(dev('Réfrigérateur', 1200))).toBe(true)
  })

  it('un appareil éteint ou de type inconnu n’est jamais signalé', () => {
    expect(estAnormal(dev('Réfrigérateur', 620, 'off'))).toBe(false)
    expect(estAnormal(dev('30A', 5000))).toBe(false) // prise non renommée
  })

  it('detecter renvoie toutes les anomalies', () => {
    const anos = detecter([dev('Réfrigérateur', 620), dev('Lampe', 30), dev('Télévision', 900)])
    expect(anos).toHaveLength(2)
  })

  it('consoStable écrête un pic anormal à la normale du type (facture cohérente)', () => {
    expect(consoStable(dev('Réfrigérateur', 560))).toBe(150) // ramené à la normale
    expect(consoStable(dev('Réfrigérateur', 160))).toBe(160) // conso normale conservée
    expect(consoStable(dev('Réfrigérateur', 160, 'off'))).toBe(0)
  })
})
