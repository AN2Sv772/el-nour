"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

interface Approval {
  id: string
  action_type: string
  title: string
  description: string
  payload: Record<string, unknown>
  impact_summary: string | null
  risk_level: string
  reversible: boolean
  status: string
  created_at: string
  approved_at: string | null
  executed_at: string | null
  error: string | null
}

const RISK_STYLE: Record<string, string> = {
  notification: 'bg-muted text-muted-foreground border-border',
  low: 'bg-success-muted text-success border-success/25',
  medium: 'bg-warning-muted text-warning border-warning/25',
  high: 'bg-destructive/10 text-destructive border-destructive/25',
}

const RISK_LABEL: Record<string, string> = {
  notification: 'إشعار فقط',
  low: 'مخاطر منخفضة',
  medium: 'مخاطر متوسطة',
  high: 'مخاطر عالية',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'بانتظار الموافقة',
  approved: 'تمت الموافقة',
  rejected: 'مرفوض',
  running: 'قيد التنفيذ',
  done: 'نُفِّذ',
  failed: 'فشل',
  expired: 'انتهت صلاحيته',
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/approvals')
      const data = await res.json()
      if (res.status === 503) {
        setAvailable(false)
        setApprovals([])
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setAvailable(true)
      setApprovals(data.approvals ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر تحميل الموافقات')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = async (id: string, action: 'approve' | 'reject' | 'undo') => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/ai/approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      toast.success(
        action === 'approve'
          ? 'تمت الموافقة ونُفِّذ الإجراء.'
          : action === 'reject'
            ? 'تم رفض الاقتراح.'
            : 'تم التراجع عن الإجراء.'
      )
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر تنفيذ الإجراء')
    } finally {
      setBusyId(null)
    }
  }

  const pending = approvals.filter(a => a.status === 'pending')
  const history = approvals.filter(a => a.status !== 'pending')

  const renderCard = (approval: Approval) => (
    <Card key={approval.id}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{approval.title}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              {approval.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', RISK_STYLE[approval.risk_level])}>
              {RISK_LABEL[approval.risk_level] ?? approval.risk_level}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {STATUS_LABEL[approval.status] ?? approval.status}
            </Badge>
          </div>
        </div>

        {approval.impact_summary && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-foreground/80">{approval.impact_summary}</p>
          </div>
        )}

        {approval.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-[11px] text-destructive">{approval.error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {approval.status === 'pending' && (
            <>
              <Button size="sm" onClick={() => act(approval.id, 'approve')} disabled={busyId === approval.id}>
                {busyId === approval.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                موافقة وتنفيذ
              </Button>
              <Button size="sm" variant="outline" onClick={() => act(approval.id, 'reject')} disabled={busyId === approval.id}>
                <XCircle className="h-3.5 w-3.5" />
                رفض
              </Button>
            </>
          )}
          {approval.status === 'done' && approval.reversible && (
            <Button size="sm" variant="outline" onClick={() => act(approval.id, 'undo')} disabled={busyId === approval.id}>
              <RotateCcw className="h-3.5 w-3.5" />
              تراجع
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground">
            {new Date(approval.created_at).toLocaleString('ar-EG')}
          </span>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader
          icon={ShieldCheck}
          title={
            <span className="flex items-center gap-2">
              <span>الموافقات</span>
              {pending.length > 0 && (
                <Badge variant="outline" className="gap-1 border-warning/30 text-warning">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {pending.length} بانتظارك
                </Badge>
              )}
            </span>
          }
          description="كل تغيير يقترحه المساعد يمرّ من هنا أولاً: يقرأ الأثر، ثم توافق أو ترفض. لا يتغيّر شيء قبل موافقتك، ولا يتكرّر التنفيذ مرتين."
        />

        {!available ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-medium">جداول الموافقات غير مطبَّقة بعد</p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    شغّل الترحيل{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[12px]">20260124000000_ai_approvals.sql</code>{' '}
                    على قاعدة البيانات، ثم أعد تحميل الصفحة.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-32 w-full animate-pulse rounded-2xl bg-muted/40" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="pending" className="space-y-4">
            <TabsList>
              <TabsTrigger value="pending">بانتظار الموافقة ({pending.length})</TabsTrigger>
              <TabsTrigger value="history">السجل ({history.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3">
              {pending.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center">
                    <p className="text-[13px] text-muted-foreground">
                      لا يوجد اقتراح بانتظار موافقتك.
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground/80">
                      اطلب من المساعد: «سجّل تكلفة المنتج ده بـ 45 جنيه».
                    </p>
                  </CardContent>
                </Card>
              ) : (
                pending.map(renderCard)
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-3">
              {history.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center">
                    <p className="text-[13px] text-muted-foreground">السجل فارغ حتى الآن.</p>
                  </CardContent>
                </Card>
              ) : (
                history.map(renderCard)
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  )
}
