import { AireConso } from './charts'
import { Card, AnimatedNumber } from './ui'

export interface Point {
  t: string
  watts: number
}

export function ConsumptionChart({ data, current }: { data: Point[]; current: number }) {
  return (
    <Card className="flex flex-col p-6">
      <div className="mb-1 flex items-start justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Consommation en temps réel</h2>
          <p className="text-sm text-muted">Puissance totale du foyer</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-accentsoft px-3 py-1 text-xs font-semibold text-accenttext ring-1 ring-accentline">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
          </span>
          En direct
        </span>
      </div>

      <p className="mb-2 font-display text-4xl font-extrabold text-ink">
        <AnimatedNumber value={current} />
        <span className="ml-1 text-xl font-bold text-muted">W</span>
      </p>

      <AireConso data={data} hauteur={224} />
    </Card>
  )
}
