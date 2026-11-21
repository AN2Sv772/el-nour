"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Lightbulb, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Decision {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  why: string
  action: { label: string; href?: string }
}

const SEVERITY_LABEL: Record<Decision['severity'], string> = {
  critical: 'حرج',
  high: 'عالٍ',
  medium: 'متوسط',
  low: 'منخفض',
  info: 'معلومة',
}

/**
 * The decisions strip — the two most urgent things the owner should look at,
 * right on the dashboard.
 *
 * It is deliberately SHORT. A list of ten decisions on the home screen is a
 * list nobody reads; the full list lives on /decisions, and this strip only
 * points at the top of it.
 */
export function DecisionsStrip({ limit = 2 }: { limit?: number }) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/decisions?dateRange=last_30_days')
      if (!res.ok) {
        setAvailable(false)
        return
      }
      const data = await res.json()
      setAvailable(true)
      setDecisions((data.decisions ?? []).slice(0, limit))
    } catch {
      setAvailable(false)
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return <Skeleton className="h-24 w-full rounded-2xl" />
  }

  if (!available || decisions.length === 0) return null

  return (
    <Card className="rounded-2xl border-border">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <p className="text-[12px] font-semibold">يحتاج قرارك</p>
          <Link
            href="/decisions"
            className="mr-auto inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            كل القرارات
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <ul className="divide-y divide-border/50">
          {decisions.map(decision => (
            <li key={decision.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <ShieldAlert
                className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0',
                  decision.severity === 'critical' ? 'text-destructive' : 'text-warning'
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[12px] font-medium">
                  {decision.title}
                  <span className="mr-1.5 text-[10px] font-normal text-muted-foreground">
                    ({SEVERITY_LABEL[decision.severity]})
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {decision.why}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
