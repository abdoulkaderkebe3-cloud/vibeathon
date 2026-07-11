import { animate } from 'framer-motion'
import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Nombre qui s'anime en douceur vers sa nouvelle valeur (compteur live). */
export function AnimatedNumber({
  value,
  decimals = 0,
}: {
  value: number
  decimals?: number
}) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    prev.current = value
    return () => controls.stop()
  }, [value])

  return (
    <span className="tnum">
      {display.toLocaleString('fr-FR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  )
}

/** Révélation orchestrée à l'apparition (fade + montée), avec délai en cascade. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** Carte blanche en relief, avec lift au survol (effet 3D). */
export function Card({
  children,
  className = '',
  interactive = true,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
}) {
  return (
    <motion.div
      whileHover={interactive ? { y: -4 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={
        'rounded-3xl border border-line bg-surface shadow-[var(--shadow-soft)] ' +
        'hover:shadow-[var(--shadow-lift)] transition-shadow duration-300 ' +
        className
      }
    >
      {children}
    </motion.div>
  )
}
