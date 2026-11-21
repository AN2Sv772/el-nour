"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricCard } from '@/components/business/metric-card'
import { CoverageMeter } from '@/components/business/coverage-meter'
import type { BusinessOverview } from '@/lib/metrics/types'
import { cn, formatCurrency } from '@/lib/utils'
import { AlertTriangle, ArrowLeft, Brain, Info, Loader2 } from 'lucide-react'

/**
 * The executive overview — the one place that shows the business NOW, with
 * every number carrying its own status.
 *
 * It is deliberately additive: the existing dashboard widgets stay, and this
 * block sits above them as the truthful layer. Where a number cannot be
 * published (profit without product costs, advertising without a connection),
 * the card says so instead of showing a zero.
 */
export function ExecutiveOverview({
  dateRange,
  onOverview,
}: {
  dateRange?: string
  onOverview?: (overview: BusinessOverview | null) => void
}) {
  const [overview, setOverview] = useState<BusinessOverview | null>(null)
  const [brain, setBrain] = useState<{ coverage: number; statusLabel: string; available: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = dateRange ? `?dateRange=${encodeURIComponent(dateRange)}` : ''
      const [overviewRes, brainRes] = await Promise.all([
        fetch(`/api/metrics/overview${query}`),
        fetch('/api/brain/status'),
      ])

      if (!overviewRes.ok) {
        const data = await overviewRes.json().catch(() => ({}))
        throw new Error(data.error ?? 'تعذّر تحميل المقاييس')
      }
      const payload: BusinessOverview = await overviewRes.json()
      setOverview(payload)
      onOverview?.(payload)

      if (brainRes.ok) {
        const data = await brainRes.json()
        setBrain({
          coverage: data.coverage ?? 0,
          statusLabel: data.statusLabel ?? '',
          available: data.available !== false,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل المقاييس')
      onOverview?.(null)
    } finally {
      setLoading(false)
    }
  }, [dateRange, onOverview])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    )
  }

  if (error || !overview) {
    return (
      <div className="card flex items-center gap-2.5 p-4 text-[12.5px] text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{error ?? 'تعذّر تحميل المقاييس'}</span>
        <Button variant="ghost" size="sm" className="ms-auto" onClick={load}>
          إعادة المحاولة
        </Button>
      </div>
    )
  }

  const revenue = overview.byKey.revenue
  const netProfit = overview.byKey.net_profit
  const fallbackProfit = overview.byKey.revenue_minus_expenses
  const orders = overview.byKey.total_orders
  const cashHeld = overview.byKey.cash_held_by_couriers

  // The critical gaps only — a banner that lists everything is a banner
  // nobody reads.
  const criticalGaps = overview.gaps.filter(g => g.severity !== 'info').slice(0, 4)

  return (
    <div className="space-y-4">
      {/* The headline row. */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {revenue && <MetricCard metric={revenue} emphasis />}
        {orders && <MetricCard metric={orders} />}
        {netProfit && <MetricCard metric={netProfit} />}
        {cashHeld && <MetricCard metric={cashHeld} />}
      </div>

      {/* The honest substitute when profit is withheld. */}
      {netProfit?.value === null && fallbackProfit && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-s-2 border-warning bg-warning-muted px-4 py-3">
          <Info className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-[12px] leading-relaxed text-foreground/80">
            صافي الربح محجوب لأن مدخلاتِه ناقصة.{' '}
            {fallbackProfit.value !== null ? (
              <>
                الرقم المتاح الآن هو{' '}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(fallbackProfit.value)}
                </span>{' '}
                — {fallbackProfit.provenance.calculation}.
              </>
            ) : (
              <>الرقم البديل محجوب أيضاً: {fallbackProfit.provenance.missing[0]}</>
            )}
          </p>
        </div>
      )}

      {/* What is missing, and what to do about it. */}
      {criticalGaps.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            <p className="text-[12px] font-semibold">ما ينقص حتى تصبح الأرقام كاملة</p>
            <Link
              href="/brain"
              className="ms-auto inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              افتح عقل النشاط
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          <ul className="divide-y divide-border-soft">
            {criticalGaps.map(gap => (
              <li key={gap.id} className="flex items-start gap-2 px-4 py-2.5">
                <span
                  className={cn(
                    'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                    gap.severity === 'critical' ? 'bg-destructive' : 'bg-warning'
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium">{gap.title}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{gap.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The Brain strip. */}
      {brain?.available && (
        <Link
          href="/brain"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3 transition-[border-color] duration-200 hover:border-primary/30"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-muted text-primary">
            <Brain className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium">عقل النشاط — {brain.statusLabel}</p>
            <p className="text-[11px] text-muted-foreground">
              كل إجابة منك تزيد ما يعرفه النظام عن نشاطك.
            </p>
          </div>
          <CoverageMeter value={brain.coverage} size={48} />
        </Link>
      )}
    </div>
  )
}
