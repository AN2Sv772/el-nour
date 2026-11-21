"use client"

import { cn } from '@/lib/utils'

/**
 * The Brain coverage meter.
 *
 * The ring shows ONE number: of the questions the owner can answer, how many
 * are answered. It is deliberately not a "quality score" — a 100% Brain can
 * still hold one wrong fact, and the knowledge items' own status is what
 * tells the truth about each fact.
 */
export function CoverageMeter({
  value,
  size = 96,
  label,
  className,
}: {
  value: number
  size?: number
  label?: string
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const stroke = size >= 80 ? 8 : 6
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference

  const tone =
    clamped >= 80 ? 'text-success' : clamped >= 40 ? 'text-warning' : 'text-destructive'
  const strokeColor =
    clamped >= 80 ? 'stroke-success' : clamped >= 40 ? 'stroke-warning' : 'stroke-destructive'

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`التغطية ${clamped}%`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-border"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn('transition-[stroke-dashoffset] duration-500', strokeColor)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('font-semibold tabular-nums', tone, size >= 80 ? 'text-lg' : 'text-sm')}>
            {clamped}%
          </span>
        </div>
      </div>
      {label && <p className="text-[12px] leading-relaxed text-muted-foreground">{label}</p>}
    </div>
  )
}
