import { Coins, Leaf, Plug, Zap } from '../components/icons'
import { ConsumptionChart, type Point } from '../components/ConsumptionChart'
import { DecisionLog } from '../components/DecisionLog'
import { DeviceList } from '../components/DeviceList'
import { ImpactCard } from '../components/ImpactCard'
import { PredictionCard } from '../components/PredictionCard'
import { StatCard } from '../components/StatCard'
import { Reveal } from '../components/ui'
import type { CommandFn } from '../lib/ws'
import type { EcoWattState } from '../types'

export function DashboardPage({
  state, history, demo, command,
}: { state: EcoWattState; history: Point[]; demo: boolean; command: CommandFn }) {
  const totalWatts = state.devices.reduce((s, d) => s + (d.etat === 'on' ? d.conso_w : 0), 0)
  const actifs = state.devices.filter((d) => d.etat === 'on').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Reveal delay={0.02}>
          <StatCard icon={Zap} label="Consommation totale" value={totalWatts} unit="W" hint="Puissance instantanée" />
        </Reveal>
        <Reveal delay={0.08}>
          <StatCard icon={Plug} label="Appareils actifs" value={actifs} unit={`/ ${state.devices.length}`} hint="Prises allumées" />
        </Reveal>
        <Reveal delay={0.14}>
          <StatCard icon={Leaf} label="Énergie évitée" value={state.impact.kwh_evites} unit="kWh" decimals={2} hint="Grâce aux coupures" />
        </Reveal>
        <Reveal delay={0.2}>
          <StatCard icon={Coins} label="Économies" value={state.impact.fcfa_economises} unit="FCFA" hint="Sur la facture" highlighted />
        </Reveal>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Reveal delay={0.26}>
            <ConsumptionChart data={history} current={totalWatts} />
          </Reveal>
          <Reveal delay={0.32}>
            <PredictionCard state={state} demo={demo} />
          </Reveal>
          <div className="grid gap-6 sm:grid-cols-2">
            <Reveal delay={0.44}>
              <DeviceList devices={state.devices} demo={demo} command={command} />
            </Reveal>
            <Reveal delay={0.5}>
              <ImpactCard impact={state.impact} projection={state.impact_projection_10000} />
            </Reveal>
          </div>
        </div>

        <Reveal delay={0.32} className="lg:sticky lg:top-6">
          <DecisionLog decisions={state.decisions} />
        </Reveal>
      </div>
    </div>
  )
}
