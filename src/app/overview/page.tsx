"use client"

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusChip } from '@/components/business/metric-card'
import { PageHeader, SegmentedControl, InsightBlock } from '@/components/shell/page-header'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { DATE_RANGE_PRESETS } from '@/lib/date-range'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  Calculator,
  Info,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  LayoutDashboard,
  CalendarDays,
  Settings2,
  CircleDollarSign,
  Truck,
  PiggyBank,
  PackageCheck,
  Percent,
} from 'lucide-react'

/**
 * /overview — the business cockpit.
 *
 * The information architecture follows the reference product (a strip of
 * "what's happening" numbers, a profit breakdown with its calculation, a
 * daily trend, and a period-health column), but every label, number and
 * state is El Nour's own and comes from the real metric engine. A number
 * that cannot be computed is shown as "—" with the reason next to it.
 */

type Status = 'actual' | 'estimated' | 'incomplete' | 'unavailable' | 'not_applicable'

interface OverviewCard {
  key: string
  label: string
  value: number | null
  unit: 'currency' | 'count' | 'percent' | 'ratio'
  status: Status
  calculation: string
  source: string[]
  missing: string[]
  note: string
  changePercent?: number | null
}

interface Leg {
  key: string
  label: string
  value: number | null
  status: Status
  note: string
}

interface ProfitabilityLeg {
  key: 'ads' | 'operations' | 'cash'
  label: string
  share: number | null
  status: Status
  detail: string
}

interface MonthHealth {
  level: 'danger' | 'caution' | 'healthy' | 'unknown'
  headline: string
  detail: string
  signals: { key: string; label: string; value: string; level: string }[]
}

interface OverviewPayload {
  window: { preset: string; label: string; from: string | null; to: string | null; computedAt: string }
  cards: OverviewCard[]
  profitBreakdown: {
    legs: Leg[]
    profitKnown: boolean
    blocker: string | null
    note: string
  }
  trend: { date: string; revenue: number; orders: number; profit: number | null }[]
  profitability: ProfitabilityLeg[]
  monthHealth: MonthHealth
  strongest: { name: string; revenue: number; units: number } | null
  mainRisk: { title: string; detail: string; href: string } | null
  previous: { revenue: number | null; from: string | null; to: string | null } | null
}

function formatValue(card: OverviewCard): string {
  if (card.value === null) return '—'
  if (card.unit === 'currency') return formatCurrency(card.value)
  if (card.unit === 'percent') return `${Math.round(card.value)}%`
  if (card.unit === 'ratio') return `${card.value.toFixed(2)}×`
  return String(card.value)
}

/** The icon that belongs to each headline number. */
const CARD_ICONS: Record<string, React.ElementType> = {
  net_profit: CircleDollarSign,
  delivered_roas: Percent,
  profit_per_order: TrendingUp,
  rto_exposure: Truck,
  cash_missing: PiggyBank,
  delivery_rate: PackageCheck,
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState('last_7_days')

  const load = useCallback(async (range: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/overview?dateRange=${range}`)
      if (!res.ok) throw new Error('تعذّر تحميل نظرة عامة على النشاط')
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(preset)
  }, [load, preset])

  const presets = useMemo(() => DATE_RANGE_PRESETS.filter(p => p.value !== 'all'), [])

  /** The quick picks in the header — the reference shows Today / Yesterday /
   *  Last 7 days / Last 30 days and leaves the rest behind "Cards Settings". */
  const quickRanges = useMemo(
    () =>
      presets
        .filter(p => ['today', 'yesterday', 'last_7_days', 'last_30_days'].includes(p.value))
        .map(p => ({ value: p.value, label: p.label })),
    [presets]
  )

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map(t => ({
        date: t.date.slice(5),
        revenue: t.revenue,
        orders: t.orders,
      })),
    [data]
  )

  const healthTone =
    data?.monthHealth.level === 'danger'
      ? 'border-destructive/35 bg-destructive-muted/40'
      : data?.monthHealth.level === 'caution'
        ? 'border-warning/35 bg-warning-muted/40'
        : data?.monthHealth.level === 'healthy'
          ? 'border-success/30 bg-success-muted/40'
          : 'border-border bg-card'

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* ── The page header: title on the start, the window on the end ── */}
        <PageHeader
          icon={LayoutDashboard}
          title="نظرة عامة على النشاط"
          description={
            data ? `${data.window.label} · Africa/Cairo` : 'جارٍ الحساب…'
          }
          actions={
            <>
              <SegmentedControl
                options={quickRanges}
                value={preset}
                onChange={(value) => setPreset(value)}
                ariaLabel="الفترة"
              />
              <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground sm:flex">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {data?.window.from && data?.window.to
                  ? `${formatDate(data.window.from)} → ${formatDate(data.window.to)}`
                  : data?.window.label}
              </span>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                إعدادات البطاقات
              </Button>
            </>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive-muted px-3 py-2.5 text-[12.5px] text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {/* ── What's happening: the headline strip ───────────────────── */}
        <section aria-label="ما يحدث الآن">
          <h2 className="mb-2.5 text-[13px] font-semibold tracking-tight text-foreground">ما يحدث الآن</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            {loading
              ? [...Array(6)].map((_, i) => <Skeleton key={i} className="h-[88px] w-full rounded-2xl" />)
              : (data?.cards ?? []).map(card => {
                  const Icon = CARD_ICONS[card.key] ?? CircleDollarSign
                  const hasValue = card.value !== null
                  return (
                    <article
                      key={card.key}
                      className="group relative flex min-h-[88px] flex-col overflow-hidden rounded-2xl border border-border bg-card p-3 transition-[border-color] duration-200 hover:border-border-strong"
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]',
                              card.status === 'actual'
                                ? 'bg-success-muted text-success'
                                : card.status === 'estimated'
                                  ? 'bg-info-muted text-info'
                                  : card.status === 'incomplete'
                                    ? 'bg-warning-muted text-warning'
                                    : 'bg-muted text-muted-foreground'
                            )}
                          >
                            <Icon className="h-[10px] w-[10px]" aria-hidden="true" />
                          </span>
                          <span className="eyebrow truncate">{card.label}</span>
                        </div>
                      </div>

                      <div className="mt-2 flex items-baseline gap-2">
                        <span
                          className={cn(
                            'text-[19px] font-semibold leading-none tracking-tight tabular-nums',
                            hasValue ? 'text-foreground' : 'text-muted-foreground/50'
                          )}
                        >
                          {formatValue(card)}
                        </span>
                        {card.changePercent !== null && card.changePercent !== undefined && (
                          <span
                            className={cn(
                              'text-[11px] font-medium tabular-nums',
                              card.changePercent >= 0 ? 'text-success' : 'text-destructive'
                            )}
                          >
                            {card.changePercent >= 0 ? '▲' : '▼'} {Math.abs(card.changePercent).toFixed(1)}%
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">
                        {card.note}
                      </p>
                    </article>
                  )
                })}
          </div>
        </section>

        {/* ── Main grid: breakdown | trend | health ───────────────────── */}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.85fr)]">
          {/* The profit breakdown — the reference's left column. */}
          <section className="card p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight">
                الربح — {data?.window.label ?? ''}
              </h2>
              <StatusChip status={data?.profitBreakdown.profitKnown ? 'actual' : 'incomplete'} />
            </div>
            <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
              المبيعات مع الشحن وتكلفة المنتجات ومصروفات الإعلانات ورسوم COD — كل سطر بمصدره.
            </p>

            {loading ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : (
              <>
                <div className="space-y-2">
                  {(data?.profitBreakdown.legs ?? [])
                    .filter(l => l.key !== 'profit')
                    .map(leg => (
<div
                      key={leg.key}
                      data-metric-key={leg.key}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="text-[12px] text-muted-foreground">{leg.label}</span>
                      <span
                        data-metric-value
                        className={cn(
                          'text-[13px] font-semibold tabular-nums',
                          leg.value === null && 'text-muted-foreground/60'
                        )}
                      >
                        {leg.value === null ? '—' : formatCurrency(leg.value)}
                      </span>
                    </div>
                    ))}
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border-soft pt-2.5">
                  <span className="text-[12px] font-semibold">صافي الربح</span>
                  <span className="text-[17px] font-semibold tracking-tight tabular-nums">
                    {data?.profitBreakdown.profitKnown
                      ? formatCurrency(
                          data.profitBreakdown.legs.find(l => l.key === 'profit')?.value ?? 0,
                        )
                      : '—'}
                  </span>
                </div>

                <InsightBlock tone="warn" title="التكاليف ناقصة" className="mt-3">
                  {data?.profitBreakdown.note}
                  {data?.profitBreakdown.blocker && (
                    <span className="mt-1 block text-muted-foreground">
                      السبب: {data.profitBreakdown.blocker}
                    </span>
                  )}
                  {!data?.profitBreakdown.profitKnown && (
                    <Button asChild size="sm" variant="outline" className="mt-2 h-7 gap-1.5 text-[12px]">
                      <Link href="/setup/costs">
                        <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                        أدخل التكاليف
                      </Link>
                    </Button>
                  )}
                </InsightBlock>
              </>
            )}
          </section>

          {/* The daily trend — the reference's middle column. */}
          <section className="card p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight">المبيعات — الاتجاه اليومي</h2>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-muted-foreground">
              تكلفة المنتجات والشحن موزّعة على أيام الفترة.
            </p>

            {loading ? (
              <Skeleton className="h-[220px] w-full rounded-xl" />
            ) : trendData.length === 0 ? (
              <p className="py-16 text-center text-[12px] text-muted-foreground">
                لا توجد مبيعات في هذه الفترة.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={218}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="overviewRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border-soft)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                      stroke="var(--color-border)"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                      stroke="var(--color-border)"
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-popover)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        fontSize: 12,
                        direction: 'rtl',
                        boxShadow: 'var(--shadow-md)',
                      }}
                      formatter={(value, name) =>
                        name === 'revenue'
                          ? [formatCurrency(Number(value)), 'المبيعات']
                          : [String(value), 'الطلبات']
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-chart-1)"
                      strokeWidth={1.75}
                      fill="url(#overviewRevenue)"
                      name="revenue"
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>لا يُرسم خط للربح قبل أن تكون التكاليف مسجّلة — الرسم بمبيعات فقط.</span>
                </p>
              </>
            )}
          </section>

          {/* The period health — the reference's right column. */}
          <section className={cn('card border p-4', healthTone)}>
            <h2 className="text-[13px] font-semibold tracking-tight">صحة الفترة</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{data?.window.label}</p>

            {loading ? (
              <Skeleton className="mt-3 h-32 w-full rounded-xl" />
            ) : (
              <>
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    {data?.monthHealth.level === 'danger' ? (
                      <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-success" aria-hidden="true" />
                    )}
                    <span
                      className={cn(
                        'text-[14px] font-semibold leading-tight',
                        data?.monthHealth.level === 'danger'
                          ? 'text-destructive'
                          : data?.monthHealth.level === 'caution'
                            ? 'text-warning'
                            : 'text-foreground'
                      )}
                    >
                      {data?.monthHealth.headline}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {data?.monthHealth.detail}
                  </p>
                </div>

                <ul className="mt-3 space-y-1.5 border-t border-border-soft pt-3">
                  {(data?.monthHealth.signals ?? []).map(signal => (
                    <li key={signal.key} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="text-muted-foreground">{signal.label}</span>
                      <span
                        className={cn(
                          'font-medium',
                          signal.level === 'critical'
                            ? 'text-destructive'
                            : signal.level === 'attention'
                              ? 'text-warning'
                              : signal.level === 'good'
                                ? 'text-success'
                                : 'text-muted-foreground'
                        )}
                      >
                        {signal.value}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Where the money goes — the reference's profitability bars. */}
                <div className="mt-3 space-y-2.5 border-t border-border-soft pt-3">
                  <span className="eyebrow">أين تذهب الأموال</span>
                  {(data?.profitability ?? []).map(leg => (
                    <div key={leg.key}>
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span>{leg.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {leg.share === null ? 'غير متاح' : `${Math.round(leg.share * 100)}%`}
                        </span>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted-2">
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-500',
                            leg.share === null ? 'bg-muted-foreground/25' : 'bg-chart-1'
                          )}
                          style={{ width: `${leg.share === null ? 0 : Math.min(100, leg.share * 100)}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{leg.detail}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ── Strongest / risk ───────────────────────────────────────── */}
        <div className="grid gap-3 md:grid-cols-2">
          <section className="card flex items-start gap-3 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-success-muted text-success">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="eyebrow">الأقوى في الفترة</span>
              {data?.strongest ? (
                <p className="mt-0.5 text-[13px] font-semibold">
                  {data.strongest.name} — {formatCurrency(data.strongest.revenue)}{' '}
                  <span className="text-[11.5px] font-normal text-muted-foreground">
                    ({data.strongest.units} وحدة)
                  </span>
                </p>
              ) : (
                <p className="mt-0.5 text-[12px] text-muted-foreground">لا توجد مبيعات في الفترة.</p>
              )}
            </div>
          </section>

          <section className="card flex items-start gap-3 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive-muted text-destructive">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="eyebrow">أكبر خطر الآن</span>
              {data?.mainRisk ? (
                <>
                  <p className="mt-0.5 text-[13px] font-semibold">{data.mainRisk.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{data.mainRisk.detail}</p>
                  <Link
                    href={data.mainRisk.href}
                    className="mt-1 inline-block text-[11.5px] font-medium text-primary hover:underline"
                  >
                    افتح القرارات
                  </Link>
                </>
              ) : (
                <p className="mt-0.5 text-[12px] text-muted-foreground">لا توجد مخاطر مسجّلة في هذه الفترة.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  )
}
