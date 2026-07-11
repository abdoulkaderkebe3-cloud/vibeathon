import { JaugeRadiale } from '../components/charts'
import { CloudOff, Coins, Leaf } from '../components/icons'
import { AnimatedNumber, Card, Reveal } from '../components/ui'
import type { EcoWattState, Impact } from '../types'

const GOAL_FCFA = 500

function BigStat({ icon: Icon, value, unit, decimals = 0 }: { icon: typeof Leaf; value: number; unit: string; decimals?: number }) {
  return (
    <Card className="p-5">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-accentsoft text-accenttext ring-1 ring-accentline">
        <Icon size={22} strokeWidth={2.3} />
      </div>
      <p className="font-display text-3xl font-extrabold text-ink">
        <AnimatedNumber value={value} decimals={decimals} />
      </p>
      <p className="text-sm font-medium text-muted">{unit}</p>
    </Card>
  )
}

export function ImpactPage({ state }: { state: EcoWattState }) {
  const impact = state.impact
  const proj: Impact = state.impact_projection_10000
  const pct = Math.min(100, (impact.fcfa_economises / GOAL_FCFA) * 100)

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Reveal delay={0.02} className="lg:col-span-1">
          <Card className="p-6">
            <h2 className="mb-1 font-display text-lg font-bold text-ink">Objectif du jour</h2>
            <p className="text-sm text-muted">Cible : {GOAL_FCFA} FCFA d'économies</p>
            <JaugeRadiale pct={pct} className="mx-auto my-4 h-52 w-52">
              <p className="font-display text-4xl font-extrabold text-ink">
                <AnimatedNumber value={Math.round(pct)} />%
              </p>
              <p className="text-xs font-semibold text-accenttext">de l'objectif</p>
            </JaugeRadiale>
          </Card>
        </Reveal>

        <div className="grid gap-6 sm:grid-cols-3 lg:col-span-2">
          <Reveal delay={0.08}><BigStat icon={Leaf} value={impact.kwh_evites} unit="kWh évités" decimals={2} /></Reveal>
          <Reveal delay={0.14}><BigStat icon={Coins} value={impact.fcfa_economises} unit="FCFA économisés" /></Reveal>
          <Reveal delay={0.2}><BigStat icon={CloudOff} value={impact.co2_evite_kg} unit="kg CO2 évités" decimals={2} /></Reveal>

          <Reveal delay={0.26} className="sm:col-span-3">
            <Card interactive={false} className="relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
              <p className="relative text-sm font-semibold text-white/85">Effet à l'échelle du pays</p>
              <p className="relative mt-2 text-sm text-white/80">Si 10 000 foyers ivoiriens utilisent EcoWatt :</p>
              <div className="relative mt-4 flex flex-wrap gap-8">
                <div>
                  <p className="font-display text-3xl font-extrabold"><AnimatedNumber value={proj.fcfa_economises} /></p>
                  <p className="text-xs text-white/75">FCFA économisés</p>
                </div>
                <div>
                  <p className="font-display text-3xl font-extrabold"><AnimatedNumber value={proj.co2_evite_kg} /></p>
                  <p className="text-xs text-white/75">kg CO2 évités</p>
                </div>
                <div>
                  <p className="font-display text-3xl font-extrabold"><AnimatedNumber value={proj.kwh_evites} /></p>
                  <p className="text-xs text-white/75">kWh évités</p>
                </div>
              </div>
            </Card>
          </Reveal>
        </div>
      </div>

      <Reveal delay={0.32}>
        <Card interactive={false} className="p-6">
          <h3 className="font-display text-base font-bold text-ink">Comment on calcule</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            L'impact part de la consommation <strong className="text-ink">réellement évitée</strong> : la puissance coupée
            par l'IA, multipliée par la durée de coupure. On la convertit en FCFA (prix du kWh CIE) et en CO2 (facteur
            d'émission du mix électrique ivoirien, surtout du gaz). Aucune valeur n'est inventée, tout vient des mesures
            des prises.
          </p>
        </Card>
      </Reveal>
    </div>
  )
}
