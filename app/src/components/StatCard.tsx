import type { IconType } from './icons'
import { Card, AnimatedNumber } from './ui'

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  decimals = 0,
  hint,
  highlighted = false,
}: {
  icon: IconType
  label: string
  value: number
  unit: string
  decimals?: number
  hint?: string
  highlighted?: boolean
}) {
  if (highlighted) {
    return (
      <Card className="relative overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 p-5 text-white">
        <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-2xl bg-white/20 backdrop-blur">
          <Icon size={20} strokeWidth={2.4} />
        </div>
        <p className="relative text-sm font-semibold text-white/85">{label}</p>
        <p className="relative mt-3 font-display text-4xl font-extrabold tracking-tight">
          <AnimatedNumber value={value} decimals={decimals} />
          <span className="ml-1 text-lg font-bold text-white/80">{unit}</span>
        </p>
        {hint && <p className="relative mt-1 text-xs text-white/75">{hint}</p>}
      </Card>
    )
  }

  return (
    <Card className="relative p-5">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-accentsoft text-accenttext ring-1 ring-accentline">
        <Icon size={20} strokeWidth={2.4} />
      </div>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink">
        <AnimatedNumber value={value} decimals={decimals} />
        <span className="ml-1 text-base font-bold text-muted">{unit}</span>
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  )
}
