import { useState } from 'react'
import { Sparkles } from '../components/icons'
import { Card, Reveal } from '../components/ui'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-semibold text-ink">{label}</label>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  )
}

const inputCls =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-accentline'

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative h-7 w-12 rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-line'}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

export function SettingsPage({ mock }: { mock: boolean }) {
  const [peakStart, setPeakStart] = useState(18)
  const [peakEnd, setPeakEnd] = useState(22)
  const [pic, setPic] = useState(800)
  const [budget, setBudget] = useState(500)
  const [demo, setDemo] = useState(mock)
  const [saved, setSaved] = useState(false)

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Reveal delay={0.02}>
        <Card interactive={false} className="p-6">
          <h2 className="mb-5 font-display text-lg font-bold text-ink">Règles de décision</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Début heure de pointe" hint="Heure (0-23)">
              <input type="number" min={0} max={23} value={peakStart} onChange={(e) => setPeakStart(+e.target.value)} className={inputCls} />
            </Field>
            <Field label="Fin heure de pointe" hint="Heure (0-23)">
              <input type="number" min={0} max={23} value={peakEnd} onChange={(e) => setPeakEnd(+e.target.value)} className={inputCls} />
            </Field>
            <Field label="Seuil de pic" hint="Puissance (W) déclenchant l'IA">
              <input type="number" min={0} step={50} value={pic} onChange={(e) => setPic(+e.target.value)} className={inputCls} />
            </Field>
            <Field label="Objectif d'économies" hint="Cible du jour (FCFA)">
              <input type="number" min={0} step={50} value={budget} onChange={(e) => setBudget(+e.target.value)} className={inputCls} />
            </Field>
          </div>
        </Card>
      </Reveal>

      <Reveal delay={0.1}>
        <Card interactive={false} className="p-6">
          <h2 className="mb-5 font-display text-lg font-bold text-ink">Cerveau IA</h2>
          <div className="space-y-4">
            <Field label="Modèle" hint="Fournisseur (gratuit) au format OpenAI-compatible">
              <div className="flex items-center gap-2 rounded-xl bg-accentsoft px-3.5 py-2.5 ring-1 ring-accentline">
                <Sparkles size={16} className="text-accenttext" />
                <span className="text-sm font-semibold text-accenttext">Llama 3.3 70B · Groq (llama-3.3-70b-versatile)</span>
              </div>
            </Field>
            <div className="flex items-center justify-between rounded-xl border border-line p-4">
              <div>
                <p className="text-sm font-semibold text-ink">Mode démo (simulateur local)</p>
                <p className="text-xs text-muted">Désactive les appels réseau à l'IA et rejoue le scénario.</p>
              </div>
              <Toggle on={demo} onToggle={() => setDemo((v) => !v)} />
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal delay={0.16}>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3 text-sm font-bold text-white shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5"
          >
            Enregistrer
          </button>
          {saved && <span className="text-sm font-semibold text-accenttext">✓ Réglages enregistrés (démo)</span>}
        </div>
        <p className="mt-3 text-xs text-muted">
          Note : en démo ces réglages restent locaux. En production, ils correspondent aux variables du backend
          (ECOWATT_PEAK_START, ECOWATT_PIC_WATTS, etc.).
        </p>
      </Reveal>
    </div>
  )
}
