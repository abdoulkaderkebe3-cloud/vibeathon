import { describe, expect, it } from 'vitest'
import { cheminLisse, ordonneeBezier, segmentsBezier, tangentesMonotones } from './courbe'

/** Ordonnées minimale et maximale réellement atteintes par la courbe, segment par segment. */
function extremaTraces(xs: number[], ys: number[], pas = 40) {
  let min = Infinity
  let max = -Infinity
  for (const s of segmentsBezier(xs, ys)) {
    for (let k = 0; k <= pas; k++) {
      const y = ordonneeBezier(s, k / pas)
      if (y < min) min = y
      if (y > max) max = y
    }
  }
  return { min, max }
}

const abscisses = (n: number, dx = 10) => Array.from({ length: n }, (_, i) => i * dx)

describe('interpolation monotone de la courbe de consommation', () => {
  it('ne dépasse jamais les valeurs mesurées, même après un pic brutal', () => {
    // Le scénario de démo : consommation calme, pic de la bouilloire, coupure par l'IA, retour au calme.
    // Une spline cardinale plongerait sous le minimum juste après la coupure => puissance négative.
    const watts = [300, 305, 298, 1480, 1470, 302, 299, 301]
    const xs = abscisses(watts.length)

    const { min, max } = extremaTraces(xs, watts)

    expect(min).toBeGreaterThanOrEqual(Math.min(...watts) - 1e-9)
    expect(max).toBeLessThanOrEqual(Math.max(...watts) + 1e-9)
  })

  it("ne descend jamais sous zéro quand un appareil s'éteint d'un coup", () => {
    const watts = [0, 0, 1200, 1200, 0, 0]
    const xs = abscisses(watts.length)

    expect(extremaTraces(xs, watts).min).toBeGreaterThanOrEqual(0)
  })

  it('garde un palier parfaitement plat entre deux mesures égales', () => {
    // Sans l'aplatissement des tangentes, la courbe onduleraient entre deux points identiques.
    const watts = [500, 500, 500, 500]
    const xs = abscisses(watts.length)

    const { min, max } = extremaTraces(xs, watts)
    expect(max - min).toBeLessThan(1e-9)
  })

  it('passe exactement par chaque point mesuré', () => {
    const watts = [120, 800, 300, 950]
    const xs = abscisses(watts.length)

    const segments = segmentsBezier(xs, watts)
    segments.forEach((s, i) => {
      expect(ordonneeBezier(s, 0)).toBeCloseTo(watts[i], 9)
      expect(ordonneeBezier(s, 1)).toBeCloseTo(watts[i + 1], 9)
    })
  })

  it('annule la tangente sur un extremum local', () => {
    // Un sommet (montée puis descente) doit avoir une tangente plate.
    const m = tangentesMonotones([0, 100, 0], 1)
    expect(m[1]).toBe(0)
  })

  it('produit un chemin SVG exploitable, et rien du tout sans données', () => {
    expect(cheminLisse([], [])).toBe('')
    expect(cheminLisse([5], [42])).toBe('M 5 42')

    const d = cheminLisse(abscisses(3), [10, 20, 15])
    expect(d.startsWith('M 0 10')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(2) // un segment de Bézier entre chaque paire de points
    expect(d).not.toContain('NaN')
  })

  it('supporte une série constante à un seul point sans produire NaN', () => {
    expect(tangentesMonotones([7], 1)).toEqual([0])
    expect(segmentsBezier([0], [7])).toEqual([])
  })
})
