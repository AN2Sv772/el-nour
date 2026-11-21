"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, ClipboardList, Info, Sparkles } from 'lucide-react'

/**
 * /briefing — the daily business briefing.
 *
 * Every line is backed by a number from a real record; every action is a task
 * for a human. Nothing here executes anything.
 */

interface Line {
  key: string
  severity: 'critical' | 'warning' | 'info' | 'good'
  text: string
  evidence: string[]
  href?: string
}

interface Task {
  id: string
  title: string
  description: string
  priority: 'urgent' | 'high' | 'normal'
  assignee: 'owner' | 'finance' | 'operations' | 'marketing' | 'employee'
  dueDate: string
  evidence: string[]
  suggestedAction: string
  requiresApproval: boolean
  href?: string
}

interface Payload {
  date: string
  greeting: string
  headline: string
  lines: Line[]
  tasks: Task[]
  blindSpots: string[]
}

const TONE = {
  critical: { icon: AlertTriangle, cls: 'text-destructive', dot: 'bg-destructive' },
  warning: { icon: AlertTriangle, cls: 'text-warning', dot: 'bg-warning' },
  good: { icon: CheckCircle2, cls: 'text-emerald-600', dot: 'bg-emerald-500' },
  info: { icon: Info, cls: 'text-primary', dot: 'bg-primary' },
} as const

const PRIORITY = {
  urgent: { label: 'عاجل', cls: 'bg-destructive/10 text-destructive' },
  high: { label: 'مهم', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  normal: { label: 'عادي', cls: 'bg-muted text-muted-foreground' },
} as const

const ASSIGNEE = {
  owner: 'المالك',
  finance: 'المالية',
  operations: 'العمليات',
  marketing: 'التسويق',
  employee: 'موظف',
} as const

export default function BriefingPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/briefing?dateRange=last_30_days')
      if (!res.ok) throw new Error('تعذّر بناء الإحاطة')
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
          icon={Sparkles}
          title="إحاطة البيزنس اليومية"
          description={`${data?.date ?? '—'} · ${data?.greeting ?? 'جارٍ التحضير'}`}
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
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <p className="text-base font-semibold">{data?.headline}</p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {(data?.lines ?? []).map(line => {
                const tone = TONE[line.severity]
                const Icon = tone.icon
                return (
                  <Card key={line.key}>
                    <CardContent className="flex items-start gap-3 p-4">
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.cls)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{line.text}</p>
                        <ul className="mt-1 space-y-0.5">
                          {line.evidence.map(e => (
                            <li key={e} className="text-[11px] text-muted-foreground">
                              • {e}
                            </li>
                          ))}
                        </ul>
                        {line.href && (
                          <Link href={line.href} className="mt-1 inline-block text-xs text-primary underline">
                            افتح
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  مهام مقترحة ({data?.tasks.length ?? 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data?.tasks ?? []).map(task => (
                  <div key={task.id} className="rounded-xl border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          PRIORITY[task.priority].cls,
                        )}
                      >
                        {PRIORITY[task.priority].label}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {ASSIGNEE[task.assignee]}
                      </span>
                      {task.requiresApproval && (
                        <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
                          تحتاج موافقة
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">تسليم: {task.dueDate}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">{task.description}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      الخطوة المقترحة: {task.suggestedAction}
                    </p>
                    {task.href && (
                      <Link href={task.href} className="mt-1 inline-block text-xs text-primary underline">
                        افتح السجل
                      </Link>
                    )}
                  </div>
                ))}
                {(data?.tasks ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد مهام اليوم.
                  </p>
                )}
              </CardContent>
            </Card>

            {(data?.blindSpots ?? []).length > 0 && (
              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">ما لا تستطيع الإحاطة قوله بعد</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {data!.blindSpots.map(b => (
                      <li key={b} className="text-xs text-muted-foreground">
                        • {b}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    هذه الفجوات لا تُملأ بالتخمين — تُملأ بتسجيل البيانات، وعندها تنفتح الأرقام
                    تلقائيًا.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
