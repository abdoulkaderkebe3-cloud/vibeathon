import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Moon, Sun } from './icons'

function getInitial(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return true
  try {
    return localStorage.getItem('ecowatt-theme') === 'dark'
  } catch {
    return false
  }
}

/** Bouton de bascule clair / sombre. Applique la classe .dark sur <html> et persiste le choix. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(getInitial)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    try {
      localStorage.setItem('ecowatt-theme', dark ? 'dark' : 'light')
    } catch {
      /* stockage indisponible : on ignore */
    }
  }, [dark])

  return (
    <button
      onClick={() => setDark((v) => !v)}
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      className="relative grid h-10 w-10 place-items-center rounded-xl bg-surface text-ink shadow-[var(--shadow-soft)] ring-1 ring-line transition-colors hover:text-accenttext"
    >
      <motion.span
        key={dark ? 'moon' : 'sun'}
        initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="grid place-items-center"
      >
        {dark ? <Moon size={19} strokeWidth={2.3} /> : <Sun size={19} strokeWidth={2.3} />}
      </motion.span>
    </button>
  )
}
