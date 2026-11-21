"use client"

import * as React from 'react'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, HelpCircle, Info, TrendingDown, TrendingUp } from 'lucide-react'
import type { Metric, MetricStatus } from '@/lib/metrics/types'

/**
 * The status vocabulary, shared by every module.
 *
 * A metric is never shown without its state. "Incomplete" is not a failure —
 * it is the honest answer when the data behind a number is missing.
 */
export const STATUS_LABEL: Record<MetricStatus, string> = {
  actual: 'بيانات فعلية',
  estimated: 'تقديري',
  incomplete: 'غير مكتمل',
  unavailable: 'غير متاح',
  not_applicable: 'لا ينطبق',
}

/** The reference's semantic palette, used for the status dots. */
export const STATUS_TONE: Record<MetricStatus, string> = {
  actual: 'bg-success-muted text-success',
  estimated: 'bg-info-muted text-info',
  incomplete: 'bg-warning-muted text-warning',
  unavailable: 'bg-muted text-muted-foreground',
  not_applicable: 'bg-muted text-muted-foreground',
}

export function StatusChip({ status, className }: { status: MetricStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
        STATUS_TONE[status],
        className
      )}
    >
      {status === 'actual' ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      ) : status === 'estimated' ? (
        <Info className="h-3 w-3" aria-hidden="true" />
      ) : status === 'incomplete' ? (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <HelpCircle className="h-3 w-3" aria-hidden="true" />
      )}
      {STATUS_LABEL[status]}
    </span>
  )
}

/**
 * One formatter for the whole app.
 *
 * The card used to render `Intl.NumberFormat('ar-EG', { style: 'currency' })`,
 * which produced Arabic-Indic digits and the trailing "ج.م." — so the
 * dashboard said "٣١٥٬٨٨٠٫٠٠ ج.م." while the cockpit said "315,880 ج.م".
 * Two screens, two spellings of the same number, is exactly the kind of
 * thing that makes an owner stop trusting the dashboard.
 */
function formatValue(metric: Metric): string {
  if (metric.value === null) return '—'
  if (metric.unit === 'percent') return `${metric.value.toFixed(1)}%`
  if (metric.unit === 'count') return formatNumber(metric.value)
  if (metric.unit === 'ratio') return `${metric.value.toFixed(2)}×`
  return formatCurrency(metric.value)
}

/**
 * A metric card that shows the number AND its provenance.
 *
 * The disclosure row is not decoration: it answers "how do you know?" with
 * the formula, the source tables, the window and the last update.
 */
export function MetricCard({
  metric,
  className,
  emphasis = false,
}: {
  metric: Metric
  className?: string
  emphasis?: boolean
}) {
  const hasValue = metric.value !== null
  const change = metric.changePercent
  const direction = change === null || change === undefined ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  return (
    <div
      data-metric-key={metric.key}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-border bg-card p-3.5 transition-[border-color] duration-200 hover:border-border-strong',
        emphasis && 'border-primary/30 bg-primary-soft',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow truncate">{metric.label}</span>
        <StatusChip status={metric.provenance.status} />
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          data-metric-value
          className={cn(
            'text-[19px] font-semibold leading-none tracking-tight tabular-nums',
            !hasValue && 'text-muted-foreground/50'
          )}
          aria-label={`${metric.label}: ${hasValue ? formatValue(metric) : 'غير متاح'}`}
        >
          {formatValue(metric)}
        </span>
        {direction && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
              direction === 'up' && 'text-success',
              direction === 'down' && 'text-destructive',
              direction === 'flat' && 'text-muted-foreground'
            )}
          >
            {direction === 'up' && <TrendingUp className="h-3 w-3" aria-hidden="true" />}
            {direction === 'down' && <TrendingDown className="h-3 w-3" aria-hidden="true" />}
            {direction === 'up' ? 'أعلى' : direction === 'down' ? 'أقل' : 'بدون تغيير'}
            {change !== null && change !== undefined && direction !== 'flat' && (
              <> {Math.abs(change).toFixed(1)}%</>
            )}
          </span>
        )}
      </div>

      {!hasValue && metric.provenance.missing.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">
          {metric.provenance.missing[0]}
        </p>
      )}

      <details className="group/details mt-2">
        <summary className="cursor-pointer list-none text-[10.5px] text-muted-foreground/80 transition-colors hover:text-foreground">
          كيف تم الحساب؟
        </summary>
        <dl className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground/70">المعادلة: </dt>
            <dd className="inline">{metric.provenance.calculation}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground/70">المصدر: </dt>
            <dd className="inline">{metric.provenance.source.join('، ') || '—'}</dd>
          </div>
          {metric.provenance.missing.length > 0 && (
            <div>
              <dt className="inline font-medium text-foreground/70">ناقص: </dt>
              <dd className="inline">{metric.provenance.missing.join(' • ')}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  )
}
