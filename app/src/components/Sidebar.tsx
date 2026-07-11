import {
  LayoutDashboard,
  Leaf,
  MessageSquare,
  X,
} from './icons'
import { motion } from 'framer-motion'
import type { IconType } from './icons'
import type { View } from '../types'

const nav: { id: View; icon: IconType; label: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { id: 'assistant', icon: MessageSquare, label: 'Assistant IA' },
]

export function Sidebar({
  active,
  onNavigate,
  open,
  onClose,
  demoOn,
  onToggleDemo,
  demoOnly = false,
}: {
  active: View
  onNavigate: (v: View) => void
  open: boolean
  onClose: () => void
  demoOn: boolean
  onToggleDemo: () => void
  demoOnly?: boolean
}) {
  return (
    <>
      {/* Fond sombre (mobile uniquement, quand le tiroir est ouvert) */}
      {open && <div onClick={onClose} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[264px] shrink-0 flex-col gap-2 overflow-y-auto bg-canvas p-5 shadow-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:shadow-none lg:transition-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        {/* Logo + fermeture mobile */}
        <div className="mb-4 flex items-center justify-between gap-3 px-2">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-[var(--shadow-hero)]">
              <Leaf size={22} strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-display text-xl font-extrabold leading-none text-ink">
                Eco<span className="text-brand-600">Watt</span>
              </p>
              <p className="text-[11px] font-medium text-muted">Énergie pilotée par IA</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink lg:hidden"
            aria-label="Fermer le menu"
          >
            <X size={20} strokeWidth={2.4} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1">
          {nav.map((item, i) => {
            const isActive = item.id === active
            return (
              <motion.button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 * i, duration: 0.35 }}
                className={`group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[var(--shadow-lift)]'
                    : 'text-muted hover:bg-surface hover:text-ink hover:shadow-[var(--shadow-soft)]'
                }`}
              >
                <item.icon
                  size={19}
                  strokeWidth={2.2}
                  className={isActive ? 'text-white' : 'text-brand-600 transition-transform group-hover:scale-110'}
                />
                {item.label}
              </motion.button>
            )
          })}
        </nav>

        {/* Carte statut + profil */}
        <div className="mt-auto space-y-3 pt-4">
          {demoOnly ? (
            // Vitrine publique : indicateur statique (pas de backend à joindre en ligne).
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-left text-white shadow-[var(--shadow-hero)]">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[rgba(255,255,255,0.15)] blur-xl" />
              <div className="relative flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                <p className="text-sm font-bold">Démo live</p>
              </div>
              <p className="relative mt-1 text-xs text-white/80">Scénario simulé en temps réel</p>
            </div>
          ) : (
            <button
              onClick={onToggleDemo}
              aria-label="Basculer entre mode démo et mode réel"
              className={`relative w-full overflow-hidden rounded-3xl p-4 text-left transition-colors ${
                demoOn
                  ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-[var(--shadow-hero)]'
                  : 'bg-surface text-ink ring-1 ring-line shadow-[var(--shadow-soft)]'
              }`}
            >
              {demoOn && <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[rgba(255,255,255,0.15)] blur-xl" />}
              <div className="relative flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{demoOn ? 'Mode démo' : 'Mode réel'}</p>
                  <p className={`mt-1 text-xs ${demoOn ? 'text-white/80' : 'text-muted'}`}>
                    {demoOn ? 'Scénario simulé en boucle' : 'Données réelles du backend'}
                  </p>
                </div>
                <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${demoOn ? 'bg-[rgba(255,255,255,0.3)]' : 'bg-line'}`}>
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full transition-all ${
                      demoOn ? 'left-6 bg-[#ffffff]' : 'left-1 bg-brand-500'
                    }`}
                  />
                </span>
              </div>
            </button>
          )}

          <div className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-[var(--shadow-soft)]">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accentsoft font-display font-bold text-accenttext">
              🏠
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-ink">Mon foyer</p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Compte domestique
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
