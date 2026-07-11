import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plug, Power, Activity } from './icons'

type ConnectionStatus = 'demo' | 'connecting' | 'connected' | 'disconnected'

export function ConnectButton({
  demoMode,
  connected,
  onToggle,
}: {
  demoMode: boolean
  connected: boolean
  onToggle: () => void
}) {
  const [animating, setAnimating] = useState(false)

  const status: ConnectionStatus = demoMode
    ? 'demo'
    : connected
      ? 'connected'
      : 'disconnected'

  const libelle =
    status === 'connected'
      ? 'Boîtier connecté'
      : status === 'disconnected'
        ? 'Reconnexion…'
        : animating
          ? 'Connexion en cours…'
          : 'Connecter le boîtier'

  const handleClick = () => {
    if (demoMode) {
      // Switching to real mode → show connecting animation
      setAnimating(true)
      onToggle()
      setTimeout(() => setAnimating(false), 2000)
    } else {
      // Switching back to demo
      onToggle()
    }
  }

  return (
    <motion.button
      id="connect-hardware-btn"
      onClick={handleClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      aria-label={libelle}
      className={`
        relative flex shrink-0 items-center gap-2 overflow-hidden rounded-2xl px-4 py-3
        font-display text-sm font-bold transition-all duration-500 sm:gap-3 sm:px-5
        ${status === 'connected'
          ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-[0_8px_32px_-8px_rgba(16,185,129,0.5)]'
          : status === 'disconnected'
            ? 'bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-[0_8px_32px_-8px_rgba(244,63,94,0.5)]'
            : animating
              ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[var(--shadow-hero)]'
              : 'bg-gradient-to-r from-brand-500 to-brand-700 text-white shadow-[var(--shadow-hero)] hover:shadow-[0_24px_64px_-16px_rgba(217,119,6,0.6)]'
        }
      `}
    >
      {/* Shimmer effect on hover */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Icon */}
      <AnimatePresence mode="wait">
        <motion.span
          key={status}
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0, rotate: 90 }}
          transition={{ duration: 0.3 }}
          className="relative flex items-center"
        >
          {status === 'connected' ? (
            <Activity size={18} strokeWidth={2.5} />
          ) : status === 'disconnected' ? (
            <Power size={18} strokeWidth={2.5} />
          ) : animating ? (
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="flex items-center"
            >
              <Plug size={18} strokeWidth={2.5} />
            </motion.span>
          ) : (
            <Plug size={18} strokeWidth={2.5} />
          )}
        </motion.span>
      </AnimatePresence>

      {/* Libellé : caché sur petit écran, où il débordait de la barre (le bouton reste identifiable
          par son icône et son aria-label). */}
      <AnimatePresence mode="wait">
        <motion.span
          key={status + (animating ? '-anim' : '')}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="relative hidden whitespace-nowrap sm:inline"
        >
          {libelle}
        </motion.span>
      </AnimatePresence>

      {/* Pulsing dot for connected status */}
      {status === 'connected' && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
      )}
    </motion.button>
  )
}
