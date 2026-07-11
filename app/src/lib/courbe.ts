/**
 * Géométrie de la courbe de consommation (ADR-013).
 *
 * Isolé du composant SVG pour rester une fonction pure, donc testable : c'est la seule partie
 * réellement délicate du graphe, et une erreur y afficherait une puissance négative au jury.
 */

/** Un segment de la courbe, exprimé en Bézier cubique. */
export interface SegmentBezier {
  x0: number
  y0: number
  c1x: number
  c1y: number
  c2x: number
  c2y: number
  x1: number
  y1: number
}

/**
 * Tangentes d'une interpolation cubique monotone (Fritsch-Carlson), à x équidistants.
 *
 * Une spline cardinale ordinaire dépasse les valeurs extrêmes : sur un pic de consommation, la courbe
 * plongerait sous zéro juste après la coupure, affichant une puissance négative. La contrainte de
 * monotonie l'interdit. C'est ce que fait `type="monotone"` chez recharts.
 */
export function tangentesMonotones(ys: number[], dx: number): number[] {
  const n = ys.length
  if (n < 2) return new Array(n).fill(0)

  const pentes: number[] = []
  for (let i = 0; i < n - 1; i++) pentes.push((ys[i + 1] - ys[i]) / dx)

  const m = new Array<number>(n)
  m[0] = pentes[0]
  m[n - 1] = pentes[n - 2]
  for (let i = 1; i < n - 1; i++) {
    // Un changement de sens (extremum local) impose une tangente plate, sinon la courbe dépasse.
    m[i] = pentes[i - 1] * pentes[i] <= 0 ? 0 : (pentes[i - 1] + pentes[i]) / 2
  }

  for (let i = 0; i < n - 1; i++) {
    if (pentes[i] === 0) {
      // Palier : les deux extrémités doivent être plates, sinon la courbe ondule entre deux points égaux.
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / pentes[i]
    const b = m[i + 1] / pentes[i]
    const s = a * a + b * b
    if (s > 9) {
      // Hors du cercle de monotonie de Fritsch-Carlson : on ramène les tangentes sur son bord.
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * pentes[i]
      m[i + 1] = t * b * pentes[i]
    }
  }
  return m
}

/** Découpe la courbe en segments de Bézier cubiques passant exactement par chaque point. */
export function segmentsBezier(xs: number[], ys: number[]): SegmentBezier[] {
  if (ys.length < 2) return []
  const dx = xs[1] - xs[0]
  const m = tangentesMonotones(ys, dx)

  const segments: SegmentBezier[] = []
  for (let i = 0; i < ys.length - 1; i++) {
    segments.push({
      x0: xs[i],
      y0: ys[i],
      c1x: xs[i] + dx / 3,
      c1y: ys[i] + (m[i] * dx) / 3,
      c2x: xs[i + 1] - dx / 3,
      c2y: ys[i + 1] - (m[i + 1] * dx) / 3,
      x1: xs[i + 1],
      y1: ys[i + 1],
    })
  }
  return segments
}

/** Chemin SVG lissé passant par tous les points, sans dépassement. */
export function cheminLisse(xs: number[], ys: number[]): string {
  if (ys.length === 0) return ''
  if (ys.length === 1) return `M ${xs[0]} ${ys[0]}`

  let d = `M ${xs[0]} ${ys[0]}`
  for (const s of segmentsBezier(xs, ys)) {
    d += ` C ${s.c1x.toFixed(2)} ${s.c1y.toFixed(2)}, ${s.c2x.toFixed(2)} ${s.c2y.toFixed(2)}, ${s.x1.toFixed(2)} ${s.y1.toFixed(2)}`
  }
  return d
}

/** Évalue l'ordonnée d'un segment de Bézier cubique en t ∈ [0, 1]. Sert au tracé comme aux tests. */
export function ordonneeBezier(s: SegmentBezier, t: number): number {
  const u = 1 - t
  return u * u * u * s.y0 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y1
}
