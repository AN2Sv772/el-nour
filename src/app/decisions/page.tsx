"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatNumber } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Lightbulb,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface Decision {
  id: string
  severity: Severity
  confidence: 'high' | 'medium' | 'low'
  title: string
  why: string
  evidence: { label: string; value: string; source: string[] }[]
  impact: string | null
  action: {
    label: string
    href?: string
    proposal?: {
      type: string
      title: string
      description: string
      payload: Record<string, unknown>
      impactSummary: string
    }
  }
  rule: string
}

interface DecisionsPayload {
  window: { preset: string; label: string; from: string | null; to: string | null; timezone: string }
  decisions: Decision[]
  snapshot: {
    countedOrders: number
    deliveredOrders: number
    backlog: { total: number; value: number; olderThan30Days: number; valueOlderThan30Days: number; olderThan7Days: number }
    revenue: number
    profitStated: boolean
  }
  adPlatforms: {
    connected: { id: string; name: string }[]
    available: { id: string; name: string; source: string; requires: string[] }[]
  }
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'حرج',
  high: 'عالٍ',
  medium: 'متوسط',
  low: 'منخفض',
  info: 'معلومة',
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'border-destructive/30 bg-destructive/5',
  high: 'border-warning/35 bg-warning-muted/30',
  medium: 'border-warning/25 bg-muted/30',
  low: 'border-border bg-card',
  info: 'border-border bg-card',
}

const SEVERITY_ICON: Record<Severity, React.ElementType> = {
  critical: ShieldAlert,
  high: AlertTriangle,
  medium: AlertTriangle,
  low: Info,
  info: Info,
}

export default function DecisionsPage() {
  const [data, setData] = useState<DecisionsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/decisions?dateRange=last_30_days')
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? 'تعذّر تحميل القرارات')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** Turn a decision into an approval proposal — it never executes directly. */
  const propose = async (decision: Decision) => {
    const proposal = decision.action.proposal
    if (!proposal) return
    setBusy(decision.id)
    try {
      const res = await fetch('/api/ai/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: proposal.type,
          title: proposal.title,
          description: proposal.description,
          payload: proposal.payload,
          impact_summary: proposal.impactSummary,
          risk_level: 'medium',
          reversible: true,
        }),
      })
      const payload = await res.json()
      if (res.status === 503) {
        toast.error('جداول الموافقات غير مطبَّقة بعد — شغّل migration 20260124000000_ai_approvals.sql')
        return
      }
      if (!res.ok) throw new Error(payload.error ?? 'تعذّر إنشاء الاقتراح')
      toast.success('تم إنشاء الاقتراح — راجعه في صفحة الموافقات.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذّر إنشاء الاقتراح')
    } finally {
      setBusy(null)
    }
  }

  const criticalCount = data?.decisions.filter(d => d.severity === 'critical').length ?? 0

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <PageHeader
          icon={Lightbulb}
          title={
            <span className="flex items-center gap-2">
              <span>القرارات</span>
              {criticalCount > 0 && (
                <span className="rounded-md border border-destructive/25 bg-destructive-muted px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                  {criticalCount} حرج
                </span>
              )}
            </span>
          }
          description="كل قرار هنا مبني على أرقام حقيقية من سجلات المتجر، ومعه مصدر الأرقام والإجراء الذي يحلّه. القرار لا ينفَّذ تلقائياً — إما رابط تنقّل، أو اقتراح تنتظر موافقتك."
        />

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-[13px] text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading || !data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            {/* ── The snapshot the rules read ────────────────────────── */}
            <Card className="bg-muted/30">
              <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                <SnapshotStat
                  label="طلبات في الفترة"
                  value={formatNumber(data.snapshot.countedOrders)}
                />
                <SnapshotStat
                  label="مُسلَّمة"
                  value={formatNumber(data.snapshot.deliveredOrders)}
                />
                <SnapshotStat
                  label="طلبات عالقة > 30 يوم"
                  value={formatNumber(data.snapshot.backlog.olderThan30Days)}
                  tone={
                    data.snapshot.backlog.olderThan30Days > 0 ? 'destructive' : 'default'
                  }
                />
                <SnapshotStat
                  label="صافي الربح"
                  value={data.snapshot.profitStated ? 'محسوب' : 'محجوب'}
                  tone={data.snapshot.profitStated ? 'default' : 'warning'}
                />
              </CardContent>
            </Card>

            {/* ── The decisions ──────────────────────────────────────── */}
            {data.decisions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
                  <p className="text-[14px] font-medium">لا توجد قرارات مفتوحة</p>
                  <p className="text-[12px] text-muted-foreground">
                    البيانات المتاحة لا تُظهر مشكلة تحتاج تدخلاً الآن.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {data.decisions.map(decision => {
                  const Icon = SEVERITY_ICON[decision.severity]
                  return (
                    <Card key={decision.id} className={cn('border', SEVERITY_STYLE[decision.severity])}>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start gap-2.5">
                          <Icon
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              decision.severity === 'critical'
                                ? 'text-destructive'
                                : decision.severity === 'info'
                                  ? 'text-muted-foreground'
                                  : 'text-warning'
                            )}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-[14px] font-semibold">{decision.title}</h2>
                              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {SEVERITY_LABEL[decision.severity]}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70">
                                ثقة {decision.confidence === 'high' ? 'عالية' : decision.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/85">
                              {decision.why}
                            </p>
                          </div>
                        </div>

                        {/* Evidence */}
                        <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
                          <p className="mb-1.5 text-[10.5px] font-medium text-muted-foreground">
                            الدليل
                          </p>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {decision.evidence.map(item => (
                              <div key={item.label} className="flex items-baseline justify-between gap-2">
                                <span className="text-[11.5px] text-muted-foreground">{item.label}</span>
                                <span className="text-[11.5px] font-medium tabular-nums">
                                  {item.value}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[10px] text-muted-foreground/70" dir="ltr">
                            sources: {decision.evidence.flatMap(e => e.source).join(', ')} · rule:{' '}
                            {decision.rule}
                          </p>
                        </div>

                        {decision.impact && (
                          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                            <span className="font-medium text-foreground">الأثر:</span> {decision.impact}
                          </p>
                        )}

                        {/* Action */}
                        <div className="flex flex-wrap items-center gap-2">
                          {decision.action.href && (
                            <Button asChild size="sm" variant="outline">
                              <a href={decision.action.href}>
                                {decision.action.label}
                                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            </Button>
                          )}
                          {decision.action.proposal && (
                            <Button
                              size="sm"
                              onClick={() => propose(decision)}
                              disabled={busy === decision.id}
                            >
                              {busy === decision.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {decision.action.label}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* ── Ad platforms readiness ─────────────────────────────── */}
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="text-[13px] font-medium">منصات الإعلانات</p>
                {data.adPlatforms.connected.length === 0 ? (
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    لا توجد منصة إعلانات متصلة، لذلك يعرض النظام مصروف الإعلانات و ROAS كـ
                    "غير متاح" بدل صفر أو تقدير.
                  </p>
                ) : (
                  <p className="text-[12px] text-success">
                    متصلة: {data.adPlatforms.connected.map(p => p.name).join('، ')}
                  </p>
                )}
                <ul className="space-y-1">
                  {data.adPlatforms.available.map(platform => (
                    <li key={platform.id} className="text-[11.5px] text-muted-foreground">
                      <span className="font-medium text-foreground">{platform.name}</span> —{' '}
                      {platform.source}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

function SnapshotStat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'warning' | 'destructive'
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-[17px] font-semibold tabular-nums',
          tone === 'destructive'
            ? 'text-destructive'
            : tone === 'warning'
              ? 'text-warning'
              : 'text-foreground'
        )}
      >
        {value}
      </p>
    </div>
  )
}
