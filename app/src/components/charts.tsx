import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cheminLisse } from '../lib/courbe'

/**
 * Graphes SVG maison (ADR-013), en remplacement de recharts.
 *
 * recharts pesait 109 kB gzip, soit 46 % du JavaScript de l'app, pour trois usages : une aire, une
 * ligne et un arc. Sur une connexion ivoirienne à 400 kb/s, cela retardait le premier écran utile de
 * plusieurs secondes. Ces primitives rendent la même chose sans dépendance, donc instantanément et
 * hors-ligne. Même démarche que les icônes maison de `icons.tsx`.
 */

/** Largeur réelle du conteneur, suivie au redimensionnement (le SVG est dessiné en pixels, pas étiré). */
function useLargeur(ref: React.RefObject<HTMLElement | null>) {
  const [largeur, setLargeur] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setLargeur(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setLargeur(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return largeur
}

export interface PointAire {
  t: string
  watts: number
}

/**
 * Aire lissée de la consommation, avec dégradé et point de survol.
 * Le survol marche aussi au doigt (pointerdown/pointermove), pas seulement à la souris.
 */
export function AireConso({ data, hauteur = 224 }: { data: PointAire[]; hauteur?: number }) {
  const conteneur = useRef<HTMLDivElement>(null)
  const largeur = useLargeur(conteneur)
  const [survol, setSurvol] = useState<number | null>(null)

  const HAUT = 10 // marge haute : le pic ne colle pas au bord
  const BAS = 2

  if (largeur === 0 || data.length === 0) {
    // Premier rendu (largeur inconnue) : on réserve la place, aucun saut de mise en page.
    return <div ref={conteneur} style={{ height: hauteur }} className="w-full" />
  }

  // Même échelle que l'ancien graphe : 0 -> max observé + 200 W de respiration.
  const maxWatts = Math.max(...data.map((p) => p.watts)) + 200
  const utile = hauteur - HAUT - BAS

  const xs = data.map((_, i) => (data.length === 1 ? largeur / 2 : (i / (data.length - 1)) * largeur))
  const ys = data.map((p) => HAUT + utile - (p.watts / maxWatts) * utile)

  const ligne = cheminLisse(xs, ys)
  const aire = `${ligne} L ${xs[xs.length - 1]} ${hauteur} L ${xs[0]} ${hauteur} Z`

  const surPointeur = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pas = data.length > 1 ? largeur / (data.length - 1) : largeur
    setSurvol(Math.max(0, Math.min(data.length - 1, Math.round(x / pas))))
  }

  const pt = survol !== null ? data[survol] : null

  return (
    <div ref={conteneur} className="relative w-full" style={{ height: hauteur }}>
      <svg
        width={largeur}
        height={hauteur}
        className="touch-pan-y overflow-visible"
        onPointerMove={surPointeur}
        onPointerDown={surPointeur}
        onPointerLeave={() => setSurvol(null)}
        role="img"
        aria-label={`Courbe de consommation, ${Math.round(data[data.length - 1].watts)} watts actuellement`}
      >
        <defs>
          <linearGradient id="ecowatt-aire" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>

        <path d={aire} fill="url(#ecowatt-aire)" />
        <path d={ligne} fill="none" stroke="#d97706" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

        {survol !== null && (
          <>
            <line x1={xs[survol]} y1={HAUT} x2={xs[survol]} y2={hauteur} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" />
            <circle cx={xs[survol]} cy={ys[survol]} r={5} fill="#d97706" stroke="var(--c-surface)" strokeWidth={2} />
          </>
        )}
      </svg>

      {pt && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-[0_12px_30px_-12px_rgba(28,25,23,0.3)]"
          style={{
            left: Math.max(60, Math.min(largeur - 60, xs[survol!])),
            top: Math.max(34, ys[survol!] - 10),
          }}
        >
          <p className="text-muted">{pt.t}</p>
          <p className="font-semibold text-ink">{Math.round(pt.watts)} W</p>
        </div>
      )}
    </div>
  )
}

/**
 * Jauge circulaire (arc de progression), en remplacement du RadialBarChart.
 * Le tracé démarre en haut et tourne dans le sens horaire, extrémités arrondies.
 */
export function JaugeRadiale({
  pct,
  children,
  className = '',
}: {
  pct: number
  children?: React.ReactNode
  className?: string
}) {
  const RAYON = 43
  const EPAISSEUR = 14
  const CIRCONFERENCE = 2 * Math.PI * RAYON

  const cible = Math.max(0, Math.min(100, pct))

  // On part de zéro au montage pour que l'arc se remplisse, comme l'animation d'entrée de recharts.
  const [affiche, setAffiche] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAffiche(cible))
    return () => cancelAnimationFrame(id)
  }, [cible])

  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={RAYON} fill="none" stroke="var(--c-surface2)" strokeWidth={EPAISSEUR} />
        <circle
          cx="50"
          cy="50"
          r={RAYON}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={EPAISSEUR}
          strokeLinecap="round"
          strokeDasharray={CIRCONFERENCE}
          strokeDashoffset={CIRCONFERENCE * (1 - affiche / 100)}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      {children && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  )
}
