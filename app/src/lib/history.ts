import { useEffect, useRef, useState } from 'react'
import type { EcoWattState } from '../types'
import type { Point } from '../components/ConsumptionChart'

/**
 * Historique de démarrage pour le MODE DÉMO : un graphe vide 45 s le temps de se remplir donne une
 * mauvaise première impression. On amorce donc une courbe déjà vivante qui raconte le produit :
 * consommation de fond qui ondule, une montée d'appareil reportable, puis la chute nette au moment
 * où l'IA coupe. En mode réel on part vide (on n'invente pas d'historique de vraies mesures).
 */
function seedDemoHistory(max: number): Point[] {
  const now = Date.now()
  const n = max
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const ago = (n - i) * 1500 // ~1,5 s entre deux points, comme le flux live
    const phase = i / n
    let watts = 330 + 60 * Math.sin(i * 0.7) + (Math.random() - 0.5) * 40 // fond vivant ~300-400 W
    if (phase > 0.55 && phase < 0.72) watts = 330 + (phase - 0.55) * 6500 // montée d'un gros appareil
    else if (phase >= 0.72 && phase < 0.78) watts = 360 // l'IA vient de couper : chute nette
    pts.push({
      t: new Date(now - ago).toLocaleTimeString('fr-FR', { minute: '2-digit', second: '2-digit' }),
      watts: Math.round(watts),
    })
  }
  return pts
}

/** Accumule un historique glissant de la puissance totale pour le graphe live. */
export function useHistory(state: EcoWattState | null, demo = false, max = 30): Point[] {
  const [points, setPoints] = useState<Point[]>(() => (demo ? seedDemoHistory(max) : []))
  const lastTs = useRef<string>('')

  // Au basculement démo <-> réel, on repart d'un historique cohérent avec le mode.
  useEffect(() => {
    lastTs.current = ''
    setPoints(demo ? seedDemoHistory(max) : [])
  }, [demo, max])

  useEffect(() => {
    if (!state || state.ts === lastTs.current) return
    lastTs.current = state.ts
    const total = state.devices.reduce((s, d) => s + (d.etat === 'on' ? d.conso_w : 0), 0)
    const label = new Date(state.ts).toLocaleTimeString('fr-FR', {
      minute: '2-digit',
      second: '2-digit',
    })
    setPoints((p) => [...p, { t: label, watts: Math.round(total) }].slice(-max))
  }, [state, max])

  return points
}
