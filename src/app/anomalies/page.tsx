"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AlertTriangle, Bug, Info, ShieldAlert } from 'lucide-react'

/**
 * /anomalies — what changed, by how much, and what to check.
 *
 * Each card shows the baseline next to the actual value, because a number
 * without its baseline is not an anomaly, it is just a number.
 */

interface Anomaly {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  what: string
  baseline: string
  actual: string
  affected: number
  possibleCauses: string[]
  recommendedAction: string
  href?: string
}

interface Payload {
  window: { label: string }
  anomalies: Anomaly[]
  inputs: {
    averageShippingFee: number | null
    configuredShippingFee: number | null
    agedOrders: number
    agedValue: number
  }
}

const SEVERITY = {
  critical: { label: 'حرج', icon: ShieldAlert, tone: 'border-destructive/40 bg-destructive/5', text: 'text-destructive' },
  warning: { label: 'تحذير', icon: AlertTriangle, tone: 'border-warning/40 bg-warning/5', text: 'text-warning' },
  info: { label: 'معلومة', icon: Info, tone: 'border-border bg-card', text: 'text-primary' },
} as const

export default function AnomaliesPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/intelligence/anomalies?dateRange=last_30_days')
      if (!res.ok) throw new Error('تعذّر تحميل الشذوذ')
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <PageHeader
          icon={ShieldAlert}
          title="شذوذ الأعمال"
          description={
            <>
              ما الذي خرج عن النطاق المعتاد في {data?.window.label ?? 'الفترة'}، بكم، وما أول شيء
              تتحقق منه. لا تشخيص تلقائي — بل أدلة مرتبة.
            </>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
        ) : (data?.anomalies ?? []).length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <Bug className="mx-auto h-8 w-8 text-emerald-600" />
              <p className="mt-2 text-sm font-medium">لا يوجد شذوذ في هذه الفترة.</p>
              <p className="text-xs text-muted-foreground">كل المؤشرات داخل النطاق المعتاد.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {data!.anomalies.map(a => {
              const meta = SEVERITY[a.severity]
              const Icon = meta.icon
              return (
                <Card key={a.id} className={cn('border', meta.tone)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', meta.text)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold">{a.title}</h2>
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', meta.tone, meta.text)}>
                            {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{a.what}</p>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border bg-muted/30 px-3 py-2">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              المعتاد
                            </span>
                            <p className="text-xs font-medium">{a.baseline}</p>
                          </div>
                          <div className="rounded-lg border bg-muted/30 px-3 py-2">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              الفعلي
                            </span>
                            <p className="text-xs font-medium">{a.actual}</p>
                          </div>
                        </div>

                        <p className="mt-2 text-[11px] text-muted-foreground">
                          السجلات المتأثرة: {a.affected}
                        </p>

                        <div className="mt-3 rounded-lg border border-dashed bg-muted/20 p-3">
                          <p className="text-[11px] font-semibold">احتمالات (ليست تشخيصًا)</p>
                          <ul className="mt-1 space-y-0.5">
                            {a.possibleCauses.map(c => (
                              <li key={c} className="text-[11px] text-muted-foreground">
                                • {c}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <p className="text-xs font-medium">أول خطوة: {a.recommendedAction}</p>
                          {a.href && (
                            <Link href={a.href} className="text-xs text-primary underline">
                              افتح
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
