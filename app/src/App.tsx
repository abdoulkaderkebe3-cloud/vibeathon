import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConnectButton } from './components/ConnectButton'
import { CloudOff, Leaf, Menu } from './components/icons'
import { Sidebar } from './components/Sidebar'
import { ThemeToggle } from './components/ThemeToggle'
import { ChatPage } from './pages/ChatPage'
import { DashboardPage } from './pages/DashboardPage'
import { DecisionsPage } from './pages/DecisionsPage'
import { DevicesPage } from './pages/DevicesPage'
import { HistoryPage } from './pages/HistoryPage'
import { ImpactPage } from './pages/ImpactPage'
import { NetworkPage } from './pages/NetworkPage'
import { SettingsPage } from './pages/SettingsPage'
import { DEMO_ONLY } from './lib/config'
import { useHistory } from './lib/history'
import { useEnLigne } from './lib/reseau'
import { useEcoWattState } from './lib/ws'
import type { View } from './types'

const meta: Record<View, { title: string; subtitle: string }> = {
  dashboard: { title: 'Tableau de bord', subtitle: 'Mesure, décision et impact, appareil par appareil, en temps réel.' },
  assistant: { title: 'Assistant IA', subtitle: 'Parle à EcoWatt en langage naturel : pose des questions, donne des ordres.' },
  devices: { title: 'Appareils', subtitle: 'Toutes les prises intelligentes du foyer et leur consommation.' },
  decisions: { title: 'Décisions IA', subtitle: "L'historique des interventions de l'IA, chacune justifiée." },
  impact: { title: 'Impact', subtitle: 'Énergie, argent et CO2 économisés grâce au pilotage.' },
  history: { title: 'Historique', subtitle: "L'évolution de la consommation et le journal des évènements." },
  network: { title: 'Réseau', subtitle: 'État des prises, du backend et du cerveau IA.' },
  settings: { title: 'Réglages', subtitle: 'Paramètres de décision et configuration du cerveau IA.' },
}

export default function App() {
  const [demoMode, setDemoMode] = useState<boolean>(() => {
    if (DEMO_ONLY) return true
    try {
      return localStorage.getItem('ecowatt-mode') !== 'real'
    } catch {
      return true
    }
  })
  const toggleDemo = () => {
    if (DEMO_ONLY) return // vitrine : pas de bascule vers un backend inexistant
    setDemoMode((v) => {
      const next = !v
      try {
        localStorage.setItem('ecowatt-mode', next ? 'demo' : 'real')
      } catch {
        /* stockage indisponible */
      }
      return next
    })
  }

  const { state, connected, mock, command } = useEcoWattState(demoMode)
  const history = useHistory(state, demoMode)
  const enLigne = useEnLigne()
  const [view, setView] = useState<View>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)

  const go = (v: View) => {
    setView(v)
    setMenuOpen(false)
  }

  const renderView = () => {
    if (!state) return <p className="text-muted">Connexion au backend...</p>
    switch (view) {
      case 'dashboard':
        return <DashboardPage state={state} history={history} demo={demoMode} command={command} />
      case 'assistant':
        return <ChatPage state={state} demo={demoMode} command={command} />
      case 'devices':
        return <DevicesPage state={state} demo={demoMode} command={command} />
      case 'decisions':
        return <DecisionsPage state={state} />
      case 'impact':
        return <ImpactPage state={state} />
      case 'history':
        return <HistoryPage state={state} history={history} />
      case 'network':
        return <NetworkPage state={state} mock={mock} connected={connected} />
      case 'settings':
        return <SettingsPage mock={mock} />
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        active={view}
        onNavigate={go}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        demoOn={demoMode}
        onToggleDemo={toggleDemo}
        demoOnly={DEMO_ONLY}
      />

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
        {/* Barre supérieure mobile */}
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white">
              <Leaf size={18} strokeWidth={2.5} />
            </div>
            <span className="font-display text-lg font-extrabold text-ink">
              Eco<span className="text-brand-600">Watt</span>
            </span>
          </div>
          <button
            onClick={() => setMenuOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white text-ink shadow-[var(--shadow-soft)]"
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} strokeWidth={2.4} />
          </button>
        </div>

        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-ink sm:text-3xl">{meta[view].title}</h1>
            <p className="mt-1 text-sm text-muted">{meta[view].subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {!enLigne && (
              <span
                className="flex items-center gap-1.5 rounded-full bg-surface2 px-3 py-1.5 text-xs font-semibold text-muted ring-1 ring-line"
                title="EcoWatt continue de fonctionner : le foyer est simulé et l'assistant répond depuis vos règles locales."
              >
                <CloudOff size={13} strokeWidth={2.4} />
                Hors ligne
              </span>
            )}
            {state?.peak_now && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" /></span>
                Heure de pointe
              </span>
            )}
            {!DEMO_ONLY && <ConnectButton demoMode={demoMode} connected={connected} onToggle={toggleDemo} />}
            <ThemeToggle />
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
