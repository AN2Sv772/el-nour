"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatCurrency } from '@/lib/utils'
import { AlertTriangle, ShieldAlert, ShieldCheck, PhoneCall } from 'lucide-react'

/**
 * /risk — COD risk.
 *
 * The page states, before any score, whether the store has the delivery
 * history needed to judge risk. It never offers a "reject" button: the only
 * action it suggests is verification.
 */

interface Signal {
  key: string
  label: string
  points: number
  detail: string
  source: string[]
}

interface Assessment {
  orderId: string
  orderNumber: string | null
  score: number
  category: 'low' | 'medium' | 'high' | 'critical' | 'unknown'
  confidence: 'low' | 'medium' | 'high'
  signals: Signal[]
  recommendation: string
  requiresHumanReview: true
  dataLimited: boolean
}

interface RiskPayload {
  window: { label: string }
  assessments: Assessment[]
  counts: Record<string, number>
  valueAtRisk: number
  dataReadiness: {
    ordersScored: number
    withDeliveryHistory: number
    historyCoverage: number
    message: string
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  low: 'منخفض',
  medium: 'متوسط',
  high: 'عالٍ',
  critical: 'حرج',
  unknown: 'غير معروف',
}

const CATEGORY_TONE: Record<string, string> = {
  low: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  critical: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
}

export default function RiskPage() {
  const [data, setData] = useState<RiskPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyRisky, setOnlyRisky] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/intelligence/risk?dateRange=last_30_days')
      if (!res.ok) throw new Error('تعذّر تحميل تقييم المخاطر')
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

  const rows = (data?.assessments ?? []).filter(a => (onlyRisky ? a.score > 0 : true))

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <PageHeader
          icon={ShieldAlert}
          title="مخاطر التحصيل عند الاستلام"
          description="ترتيب الطلبات التي يستحق صاحبها التحقق منها قبل الشحن. النظام لا يرفض أي طلب ولا يتخذ قرارًا — القرار دائمًا بشري."
          actions={
            <Button variant="outline" onClick={() => setOnlyRisky(v => !v)}>
              {onlyRisky ? 'إظهار كل الطلبات' : 'إظهار الطلبات المعرّضة فقط'}
            </Button>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Data readiness — before any score */}
        {data && (
          <Card
            className={cn(
              'border',
              data.dataReadiness.withDeliveryHistory === 0
                ? 'border-warning/40 bg-warning/5'
                : 'border-emerald-500/30 bg-emerald-500/5',
            )}
          >
            <CardContent className="flex items-start gap-3 p-4">
              {data.dataReadiness.withDeliveryHistory === 0 ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              ) : (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-semibold">جاهزية البيانات</p>
                <p className="text-xs text-muted-foreground">{data.dataReadiness.message}</p>
                <p className="text-xs text-muted-foreground">
                  {data.dataReadiness.ordersScored} طلب مفتوح تم تقييمه ·{' '}
                  {data.counts.medium ?? 0} متوسط · {data.counts.high ?? 0} عالٍ ·{' '}
                  {data.counts.critical ?? 0} حرج
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600" />
              <p className="mt-2 text-sm font-medium">لا توجد طلبات معرّضة في الفترة.</p>
              <p className="text-xs text-muted-foreground">
                كل الطلبات المفتوحة مكتملة البيانات ولا تُظهر إشارات تحقق.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map(a => (
              <Card key={a.orderId}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">
                          {a.orderNumber ?? a.orderId.slice(0, 8)}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            CATEGORY_TONE[a.category],
                          )}
                        >
                          {CATEGORY_LABEL[a.category]}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          ثقة {a.confidence === 'high' ? 'عالية' : a.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}
                        </span>
                      </div>
                      {a.signals.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {a.signals.map(s => (
                            <li key={s.key} className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{s.label}:</span> {s.detail}{' '}
                              <span className="text-[10px] opacity-70">(+{s.points})</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          لا توجد إشارات تحقق — الطلب مكتمل البيانات.
                        </p>
                      )}
                    </div>
                    <div className="text-left">
                      <div className="text-2xl font-bold tabular-nums">{a.score}</div>
                      <div className="text-[10px] text-muted-foreground">من 100</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <PhoneCall className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-xs">{a.recommendation}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="border-dashed">
          <CardContent className="p-4 text-xs text-muted-foreground">
            <ShieldAlert className="mb-1 h-4 w-4" />
            <p>
              هذا التقييم لا يستخدم أي صفة حساسة (لا جنس، ولا دين، ولا مستوى دخل)، ولا يرفض أي
              طلب تلقائيًا. عندما تبدأ تسجيل نتائج التسليم، سترتفع دقة التقييم تلقائيًا. —{' '}
              <Link href="/decisions" className="text-primary underline">
                راجع القرارات
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
