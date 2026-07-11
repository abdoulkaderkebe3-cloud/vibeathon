import { JaugeRadiale } from './charts'
import { CloudOff, Coins, Leaf } from './icons'
import type { Impact } from '../types'
import { Card, AnimatedNumber } from './ui'

const GOAL_FCFA = 500 // objectif d'économies du jour (démo)

function Tile({
  icon: Icon,
  value,
  unit,
  decimals = 0,
}: {
  icon: typeof Leaf
  value: number
  unit: string
  decimals?: number
}) {
  return (
    <div className="rounded-2xl bg-accentsoft p-3 text-center ring-1 ring-accentline">
      <Icon size={16} strokeWidth={2.4} className="mx-auto mb-1 text-accenttext" />
      <p className="font-display text-lg font-extrabold text-ink">
        <AnimatedNumber value={value} decimals={decimals} />
      </p>
      <p className="text-[11px] font-medium text-muted">{unit}</p>
    </div>
  )
}

export function ImpactCard({ impact, projection }: { impact: Impact; projection: Impact }) {
  const pct = Math.min(100, (impact.fcfa_economises / GOAL_FCFA) * 100)

  return (
    <Card className="p-6">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">Impact économisé</h2>
      <p className="text-sm text-muted">Objectif du jour : {GOAL_FCFA} FCFA</p>

      <JaugeRadiale pct={pct} className="mx-auto my-2 h-44 w-44">
        <p className="font-display text-3xl font-extrabold text-ink">
          <AnimatedNumber value={impact.fcfa_economises} />
        </p>
        <p className="text-xs font-semibold text-accenttext">FCFA économisés</p>
      </JaugeRadiale>

      <div className="grid grid-cols-3 gap-2">
        <Tile icon={Leaf} value={impact.kwh_evites} unit="kWh évités" decimals={2} />
        <Tile icon={Coins} value={impact.fcfa_economises} unit="FCFA" />
        <Tile icon={CloudOff} value={impact.co2_evite_kg} unit="kg CO2" decimals={2} />
      </div>

      <div className="mt-4 rounded-2xl bg-gradient-to-r from-brand-600 to-brand-800 p-3.5 text-center text-white">
        <p className="text-xs text-white/80">Si 10 000 foyers le font</p>
        <p className="font-display text-lg font-extrabold">
          <AnimatedNumber value={projection.fcfa_economises} /> FCFA
          <span className="mx-1.5 text-white/50">·</span>
          <AnimatedNumber value={projection.co2_evite_kg} /> kg CO2
        </p>
      </div>
    </Card>
  )
}
