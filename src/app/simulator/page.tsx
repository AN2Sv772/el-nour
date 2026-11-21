"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatCurrency } from '@/lib/utils'
import { AlertTriangle, FlaskConical, Info } from 'lucide-react'

/**
 * /simulator — what-if, non-destructive.
 *
 * Nothing on this page writes to the business. It posts a set of levers to a
 * read-only endpoint and shows the arithmetic. If the inputs for the profit
 * are missing, the profit stays "—" — the simulator never becomes the place
 * where a fake profit appears.
 */

interface Lever {
  lever: string
  label: string
  hint: string
  min: number
  max: number
  step: number
}

interface Payload {
  window: { label: string }
  levers: Lever[]
  result: {
    baseline: {
      orders: number
      revenue: number
      netProfit: number | null
      marginPercent: number | null
    }
    scenario: {
      orders: number
      revenue: number
      productCost: number | null
      shippingCost: number | null
      operatingExpenses: number | null
      adSpend: number | null
      netProfit: number | null
      marginPercent: number | null
      profitDelta: number | null
      revenueDelta: number
      breakEvenOrders: number | null
      contributionPerOrder: number | null
      maxAcceptableAcquisitionCost: number | null
    }
    assumptions: string[]
    limitations: string[]
    isProjection: true
  }
}

export default function SimulatorPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (levers: Record<string, number>) => {
    setRunning(true)
    setError(null)
    try {
      const scenarios = Object.entries(levers)
        .filter(([, change]) => change !== 0)
        .map(([lever, change]) => ({ lever, change }))
      const res = await fetch('/api/intelligence/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateRange: 'last_30_days', scenarios }),
      })
      if (!res.ok) throw new Error('تعذّر تشغيل المحاكاة')
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setRunning(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run({})
  }, [run])

  const setLever = (lever: string, change: number) => {
    const next = { ...values, [lever]: change }
    setValues(next)
    void run(next)
  }

  const scenario = data?.result.scenario
  const baseline = data?.result.baseline

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <PageHeader
          icon={FlaskConical}
          title="محاكي الأرباح"
          description={
            <>
              غيّر المتغيرات وشاهد الأثر — بدون أن يتغيّر أي سجل في المتجر. المحاكاة على{' '}
              {data?.window.label ?? 'الفترة'}، وكل رقم محسوب من نفس محرّك المقاييس.
            </>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Levers */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">المتغيرات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                [...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
              ) : (
                (data?.levers ?? []).map(lever => {
                  const value = values[lever.lever] ?? 0
                  return (
                    <div key={lever.lever} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label htmlFor={`lever-${lever.lever}`} className="text-xs font-medium">
                          {lever.label}
                        </label>
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                            value === 0 ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                          )}
                        >
                          {value > 0 ? '+' : ''}
                          {(value * 100).toFixed(0)}%
                        </span>
                      </div>
                      <input
                        id={`lever-${lever.lever}`}
                        type="range"
                        min={lever.min}
                        max={lever.max}
                        step={lever.step}
                        value={value}
                        onChange={e => setLever(lever.lever, Number(e.target.value))}
                        className="w-full accent-[hsl(var(--primary))]"
                        dir="ltr"
                      />
                      <p className="text-[10px] text-muted-foreground">{lever.hint}</p>
                    </div>
                  )
                })
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setValues({})
                  void run({})
                }}
              >
                إعادة الضبط
              </Button>
            </CardContent>
          </Card>

          {/* Result */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">قبل / بعد</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <Skeleton className="h-40 w-full rounded-xl" />
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border bg-muted/30 p-3">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          الحالي
                        </span>
                        <p className="mt-1 text-lg font-bold tabular-nums">
                          {formatCurrency(baseline?.revenue ?? 0)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {baseline?.orders ?? 0} طلب · صافي ربح{' '}
                          {baseline && baseline.netProfit !== null
                            ? formatCurrency(baseline.netProfit)
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          بعد المحاكاة
                        </span>
                        <p className="mt-1 text-lg font-bold tabular-nums">
                          {formatCurrency(scenario?.revenue ?? 0)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {scenario?.orders ?? 0} طلب · صافي ربح{' '}
                          {scenario && scenario.netProfit !== null
                            ? formatCurrency(scenario.netProfit)
                            : '—'}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Row label="فرق المبيعات" value={scenario?.revenueDelta ?? 0} currency />
                      <Row
                        label="فرق صافي الربح"
                        value={scenario?.profitDelta ?? null}
                        currency
                      />
                      <Row label="هامش الربح" value={scenario?.marginPercent ?? null} percent />
                      <Row label="نقطة التعادل" value={scenario?.breakEvenOrders ?? null} orders />
                      <Row
                        label="المساهمة لكل طلب"
                        value={scenario?.contributionPerOrder ?? null}
                        currency
                      />
                      <Row
                        label="أقصى تكلفة اكتساب مسموحة"
                        value={scenario?.maxAcceptableAcquisitionCost ?? null}
                        currency
                      />
                    </div>

                    <div className="rounded-lg border border-dashed bg-muted/20 p-3">
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {scenario?.netProfit === null
                            ? 'صافي الربح ما زال محجوبًا — المحاكاة تُظهر أثر المبيعات والتكلفة فقط. '
                            : 'الأرقام محاكاة وليست وعدًا. '}
                          {data?.result.limitations.join(' ')}
                        </span>
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">الافتراضات</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {(data?.result.assumptions ?? []).map(a => (
                    <li key={a} className="text-xs text-muted-foreground">
                      • {a}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

function Row({
  label,
  value,
  currency,
  percent,
  orders,
}: {
  label: string
  value: number | null
  currency?: boolean
  percent?: boolean
  orders?: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value === null
          ? '—'
          : currency
            ? formatCurrency(value)
            : percent
              ? `${value.toFixed(1)}%`
              : orders
                ? `${value} طلب`
                : String(value)}
      </span>
    </div>
  )
}
