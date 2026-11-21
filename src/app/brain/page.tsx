"use client"

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CoverageMeter } from '@/components/business/coverage-meter'
import { StatusChip } from '@/components/business/metric-card'
import { BRAIN_AREAS, BRAIN_QUESTIONS } from '@/lib/brain/questions'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  User,
} from 'lucide-react'
import { toast } from 'sonner'

interface BrainStatus {
  available: boolean
  status: string
  statusLabel: string
  statusDescription: string
  coverage: number
  answered: number
  answerable: number
  openRequired: number
  skippedRequired: number
  knowledge: {
    total: number
    verified: number
    unverified: number
    conflicted: number
    outdated: number
    forgotten: number
  }
  gaps: { id: string; area: string; label: string; severity: string; kind: string; questionKey?: string }[]
  areas: { key: string; answered: number; answerable: number; coverage: number }[]
  lastRun: { status: string; finishedAt: string | null; coverageBefore: number | null; coverageAfter: number | null } | null
}

interface QuestionAnswerRow {
  answer: string | null
  status: 'open' | 'answered' | 'skipped'
  answer_source: string | null
  answered_at: string | null
}

const STATUS_TONE: Record<string, string> = {
  not_configured: 'bg-muted text-muted-foreground border-border',
  incomplete: 'bg-warning-muted text-warning border-warning/25',
  learning: 'bg-info-muted text-info border-info/25',
  ready: 'bg-success-muted text-success border-success/25',
  needs_attention: 'bg-destructive/10 text-destructive border-destructive/25',
  outdated: 'bg-warning-muted text-warning border-warning/25',
}

export default function BrainPage() {
  const [status, setStatus] = useState<BrainStatus | null>(null)
  const [answers, setAnswers] = useState<Record<string, QuestionAnswerRow>>({})
  const [profile, setProfile] = useState<any>(null)
  const [rules, setRules] = useState<any[]>([])
  const [goals, setGoals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [profileDraft, setProfileDraft] = useState<any>(null)
  const [ruleDraft, setRuleDraft] = useState({ title: '', body: '', scope: 'general', priority: 100 })
  const [goalDraft, setGoalDraft] = useState({ metric_key: 'revenue', target: '', unit: 'currency', period: 'monthly' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [statusRes, questionsRes, profileRes, rulesRes, goalsRes] = await Promise.all([
        fetch('/api/brain/status'),
        fetch('/api/brain/questions'),
        fetch('/api/brain/profile'),
        fetch('/api/brain/rules'),
        fetch('/api/brain/goals'),
      ])

      if (statusRes.ok) setStatus(await statusRes.json())
      if (questionsRes.ok) {
        const data = await questionsRes.json()
        setAnswers(data.answers ?? {})
      }
      if (profileRes.ok) {
        const data = await profileRes.json()
        setProfile(data.profile)
        setProfileDraft(data.profile)
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json()
        setRules(data.rules ?? [])
      }
      if (goalsRes.ok) {
        const data = await goalsRes.json()
        setGoals(data.goals ?? [])
      }
    } catch (error) {
      console.error('Brain page load failed:', error)
      toast.error('تعذّر تحميل بيانات الـBrain')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const questionsByArea = useMemo(() => {
    const map = new Map<string, typeof BRAIN_QUESTIONS>()
    for (const q of BRAIN_QUESTIONS) {
      const list = map.get(q.area) ?? []
      list.push(q)
      map.set(q.area, list)
    }
    return map
  }, [])

  const answerQuestion = async (key: string, action: 'answer' | 'skip') => {
    const answer = (drafts[key] ?? answers[key]?.answer ?? '').trim()
    if (action === 'answer' && !answer) {
      toast.error('اكتب الإجابة أولاً')
      return
    }
    setSavingKey(key)
    try {
      const res = await fetch(`/api/brain/questions/${key}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, answer }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setAnswers(prev => ({ ...prev, [key]: data.question }))
      setDrafts(prev => ({ ...prev, [key]: '' }))
      toast.success('تم حفظ الإجابة')
      // The coverage number is derived — refresh it.
      const statusRes = await fetch('/api/brain/status')
      if (statusRes.ok) setStatus(await statusRes.json())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر حفظ الإجابة')
    } finally {
      setSavingKey(null)
    }
  }

  const runAudit = async () => {
    setSavingKey('audit')
    try {
      const res = await fetch('/api/brain/audit', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to run the audit')
      toast.success(`تم التدقيق: ${data.report.findings.length} ملاحظة`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر تشغيل التدقيق')
    } finally {
      setSavingKey(null)
    }
  }

  const saveProfile = async () => {
    setSavingKey('profile')
    try {
      const res = await fetch('/api/brain/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileDraft ?? {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setProfile(data.profile)
      toast.success('تم حفظ ملف النشاط')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر الحفظ')
    } finally {
      setSavingKey(null)
    }
  }

  const addRule = async () => {
    setSavingKey('rule')
    try {
      const res = await fetch('/api/brain/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleDraft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setRules(prev => [...prev, data.rule])
      setRuleDraft({ title: '', body: '', scope: 'general', priority: 100 })
      toast.success('تمت إضافة القاعدة')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر إضافة القاعدة')
    } finally {
      setSavingKey(null)
    }
  }

  const saveGoals = async () => {
    setSavingKey('goals')
    try {
      const next = [...goals]
      const existing = next.find(g => g.metric_key === goalDraft.metric_key)
      const row = { ...goalDraft, target: Number(goalDraft.target) }
      if (existing) {
        const res = await fetch('/api/brain/goals', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goals: next.map(g => (g.metric_key === goalDraft.metric_key ? row : g)) }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to save')
        setGoals(data.goals)
      } else {
        const res = await fetch('/api/brain/goals', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goals: [...next, row] }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to save')
        setGoals(data.goals)
      }
      setGoalDraft({ metric_key: 'revenue', target: '', unit: 'currency', period: 'monthly' })
      toast.success('تم حفظ الأهداف')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر حفظ الأهداف')
    } finally {
      setSavingKey(null)
    }
  }

  const notConfigured = status && !status.available

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <PageHeader
          icon={Brain}
          title={
            <span className="flex items-center gap-2">
              <span>عقل النشاط</span>
              {status && (
                <span className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium', STATUS_TONE[status.status])}>
                  {status.statusLabel}
                </span>
              )}
            </span>
          }
          description="ما الذي يعرفه النظام عن نشاطك فعلاً؟ التغطية تُحسب من إجاباتك أنت — من جداول المخزون والطلبات، ومن قاعدة المعرفة. ما لا تعرفه لا يُخمَّن."
          actions={
            <Button onClick={runAudit} disabled={savingKey === 'audit' || notConfigured === true} variant="outline" size="sm">
              {savingKey === 'audit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              تشغيل التدقيق
            </Button>
          }
        />

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : notConfigured ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-medium">جداول الـBrain غير مطبَّقة بعد</p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    شغّل الترحيل <code className="rounded bg-muted px-1 py-0.5 text-[12px]">20260123000000_business_brain.sql</code>{' '}
                    على قاعدة البيانات، ثم أعد تحميل الصفحة. لن يتم عرض أي رقم قبل ذلك.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
              <TabsTrigger value="questions">أسئلة لك</TabsTrigger>
              <TabsTrigger value="profile">ملف النشاط</TabsTrigger>
              <TabsTrigger value="rules">القواعد والأهداف</TabsTrigger>
            </TabsList>

            {/* ── Overview ───────────────────────────────────────────────── */}
            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center gap-6">
                    <CoverageMeter
                      value={status?.coverage ?? 0}
                      label={
                        status
                          ? `${status.answered} من ${status.answerable} سؤالاً واجباً تم الإجابة عنه`
                          : undefined
                      }
                    />
                    <div className="min-w-[220px] flex-1 space-y-2">
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        {status?.statusDescription}
                      </p>
                      {status && status.openRequired > 0 && (
                        <Badge variant="outline" className="gap-1 border-warning/30 text-warning">
                          <CircleHelp className="h-3 w-3" aria-hidden="true" />
                          {status.openRequired} سؤال مفتوح
                        </Badge>
                      )}
                      {status?.lastRun?.finishedAt && (
                        <p className="text-[11px] text-muted-foreground/80">
                          آخر تدقيق: {new Date(status.lastRun.finishedAt).toLocaleString('ar-EG')}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {status?.knowledge &&
                  [
                    { label: 'معلومات موثّقة', value: status.knowledge.verified, tone: 'text-success' },
                    { label: 'غير موثّقة', value: status.knowledge.unverified, tone: 'text-warning' },
                    { label: 'متعارضة', value: status.knowledge.conflicted, tone: 'text-destructive' },
                    { label: 'تحتاج تحديث', value: status.knowledge.outdated, tone: 'text-warning' },
                  ].map(item => (
                    <Card key={item.label}>
                      <CardContent className="p-4">
                        <p className="text-[12px] text-muted-foreground">{item.label}</p>
                        <p className={cn('mt-1 text-[22px] font-semibold tabular-nums', item.tone)}>
                          {item.value}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[15px]">التغطية حسب المجال</CardTitle>
                    <CardDescription className="text-[12px]">
                      كل مجال يُقاس بالأسئلة الواجبة فيه فقط.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(status?.areas ?? []).map(area => {
                      const definition = BRAIN_AREAS.find(a => a.key === area.key)
                      return (
                        <div key={area.key} className="space-y-1.5">
                          <div className="flex items-center justify-between text-[12px]">
                            <span className="font-medium">{definition?.label_ar ?? area.key}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {area.answered}/{area.answerable} · {area.coverage}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                area.coverage >= 80 ? 'bg-success' : area.coverage >= 40 ? 'bg-warning' : 'bg-destructive'
                              )}
                              style={{ width: `${area.coverage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-[15px]">ما ينقصك</CardTitle>
                    <CardDescription className="text-[12px]">
                      كل بند هنا قابل للتنفيذ — إجابة أو قرار منك.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(status?.gaps ?? []).length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">لا شيء ناقص — إجاباتك مكتملة.</p>
                    ) : (
                      (status?.gaps ?? []).slice(0, 12).map(gap => (
                        <div
                          key={gap.id}
                          className={cn(
                            'flex items-start gap-2 rounded-lg border px-3 py-2',
                            gap.severity === 'critical'
                              ? 'border-destructive/25 bg-destructive/5'
                              : 'border-border bg-muted/40'
                          )}
                        >
                          <AlertTriangle
                            className={cn(
                              'mt-0.5 h-3.5 w-3.5 shrink-0',
                              gap.severity === 'critical' ? 'text-destructive' : 'text-warning'
                            )}
                            aria-hidden="true"
                          />
                          <p className="text-[12px] leading-relaxed">{gap.label}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Questions ──────────────────────────────────────────────── */}
            <TabsContent value="questions" className="space-y-4">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                هذه الأسئلة لا يجيب عنها أي جدول — إجاباتك هي المعرفة نفسها. كل سؤال اختياري يمكن
                تخطّيه، لكن تخطّئه لا يرفع التغطية.
              </p>
              {BRAIN_AREAS.map(area => (
                <Card key={area.key}>
                  <CardHeader>
                    <CardTitle className="text-[15px]">{area.label_ar}</CardTitle>
                    <CardDescription className="text-[12px]">{area.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(questionsByArea.get(area.key) ?? []).map(question => {
                      const answer = answers[question.key]
                      const draft = drafts[question.key] ?? answer?.answer ?? ''
                      const isAnswered = answer?.status === 'answered'
                      return (
                        <div
                          key={question.key}
                          className="rounded-lg border border-border bg-background/40 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-medium leading-relaxed">{question.prompt_ar}</p>
                            {question.required ? (
                              <Badge variant="outline" className="shrink-0 text-[10px]">واجب</Badge>
                            ) : (
                              <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">اختياري</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            لماذا يهم: {question.why_it_matters}
                          </p>
                          <Textarea
                            value={draft}
                            onChange={e => setDrafts(prev => ({ ...prev, [question.key]: e.target.value }))}
                            placeholder="اكتب إجابتك هنا…"
                            className="mt-2 min-h-[70px] text-[13px]"
                          />
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => answerQuestion(question.key, 'answer')}
                              disabled={savingKey === question.key}
                            >
                              {savingKey === question.key ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              {isAnswered ? 'تحديث الإجابة' : 'حفظ الإجابة'}
                            </Button>
                            {!question.required && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => answerQuestion(question.key, 'skip')}
                                disabled={savingKey === question.key}
                              >
                                تخطّ
                              </Button>
                            )}
                            {isAnswered && (
                              <span className="text-[11px] text-muted-foreground">
                                أُجيب في {answer?.answered_at ? new Date(answer.answered_at).toLocaleDateString('ar-EG') : '—'}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* ── Profile ────────────────────────────────────────────────── */}
            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle className="text-[15px] flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" aria-hidden="true" />
                    ملف النشاط وعقد التشغيل
                  </CardTitle>
                  <CardDescription className="text-[12px]">
                    هذه القواعد يقرأها الوكيل قبل أي اقتراح. «لا تفعل» و«الحد الأدنى للنقد» تمنعه من
                    اقتراح قرار يضرّ النشاط.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="business_name">اسم النشاط</Label>
                      <Input
                        id="business_name"
                        value={profileDraft?.business_name ?? ''}
                        onChange={e => setProfileDraft((p: any) => ({ ...p, business_name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="primary_focus">الأولوية</Label>
                      <select
                        id="primary_focus"
                        value={profileDraft?.primary_focus ?? ''}
                        onChange={e => setProfileDraft((p: any) => ({ ...p, primary_focus: e.target.value || null }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]"
                      >
                        <option value="">— لم يُحدَّد —</option>
                        <option value="growth">النمو</option>
                        <option value="profit">الربح</option>
                        <option value="cash">النقد</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cash_floor">حد النقد الأدنى (ج.م)</Label>
                      <Input
                        id="cash_floor"
                        type="number"
                        value={profileDraft?.cash_floor ?? ''}
                        onChange={e => setProfileDraft((p: any) => ({ ...p, cash_floor: e.target.value === '' ? null : Number(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="max_daily_ad_spend">سقف الإنفاق الإعلاني اليومي (ج.م)</Label>
                      <Input
                        id="max_daily_ad_spend"
                        type="number"
                        value={profileDraft?.max_daily_ad_spend ?? ''}
                        onChange={e => setProfileDraft((p: any) => ({ ...p, max_daily_ad_spend: e.target.value === '' ? null : Number(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="description_ar">وصف النشاط</Label>
                    <Textarea
                      id="description_ar"
                      value={profileDraft?.description_ar ?? ''}
                      onChange={e => setProfileDraft((p: any) => ({ ...p, description_ar: e.target.value }))}
                      className="min-h-[90px] text-[13px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="never_rules">قواعد «لا تفعل» (قائمة، سطر لكل قاعدة)</Label>
                    <Textarea
                      id="never_rules"
                      value={(profileDraft?.never_rules ?? []).join('\n')}
                      onChange={e =>
                        setProfileDraft((p: any) => ({
                          ...p,
                          never_rules: e.target.value.split('\n').filter(Boolean),
                        }))
                      }
                      className="min-h-[80px] text-[13px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="hard_constraints">قيود صارمة (قائمة، سطر لكل قيد)</Label>
                    <Textarea
                      id="hard_constraints"
                      value={(profileDraft?.hard_constraints ?? []).join('\n')}
                      onChange={e =>
                        setProfileDraft((p: any) => ({
                          ...p,
                          hard_constraints: e.target.value.split('\n').filter(Boolean),
                        }))
                      }
                      className="min-h-[80px] text-[13px]"
                    />
                  </div>

                  <Button onClick={saveProfile} disabled={savingKey === 'profile'}>
                    {savingKey === 'profile' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    حفظ ملف النشاط
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Rules & goals ──────────────────────────────────────────── */}
            <TabsContent value="rules" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[15px] flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
                      قواعد النشاط
                    </CardTitle>
                    <CardDescription className="text-[12px]">
                      قواعد بصيغة طبيعية يلتزم بها الوكيل.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {rules.length === 0 && (
                      <p className="text-[13px] text-muted-foreground">لا توجد قواعد بعد.</p>
                    )}
                    {rules.map(rule => (
                      <div key={rule.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-medium">{rule.title}</p>
                          <Badge variant="outline" className="shrink-0 text-[10px]">{rule.scope}</Badge>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{rule.body}</p>
                      </div>
                    ))}
                    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                      <Input
                        value={ruleDraft.title}
                        onChange={e => setRuleDraft(p => ({ ...p, title: e.target.value }))}
                        placeholder="عنوان القاعدة"
                        className="text-[13px]"
                      />
                      <Textarea
                        value={ruleDraft.body}
                        onChange={e => setRuleDraft(p => ({ ...p, body: e.target.value }))}
                        placeholder="اكتب القاعدة كما تطبّقها في نشاطك…"
                        className="min-h-[70px] text-[13px]"
                      />
                      <Button size="sm" onClick={addRule} disabled={savingKey === 'rule'}>
                        {savingKey === 'rule' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        إضافة قاعدة
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-[15px] flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                      أهداف النشاط
                    </CardTitle>
                    <CardDescription className="text-[12px]">
                      المفاتيح نفسها التي تنشرها صفحة المقاييس.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {goals.length === 0 && (
                      <p className="text-[13px] text-muted-foreground">لا توجد أهداف محددة بعد.</p>
                    )}
                    {goals.map(goal => (
                      <div
                        key={goal.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                      >
                        <span className="text-[12px] font-medium">{goal.metric_key}</span>
                        <span className="text-[12px] tabular-nums text-muted-foreground">
                          {goal.target} / {goal.period}
                        </span>
                      </div>
                    ))}
                    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                      <select
                        value={goalDraft.metric_key}
                        onChange={e => setGoalDraft(p => ({ ...p, metric_key: e.target.value }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]"
                      >
                        <option value="revenue">revenue</option>
                        <option value="net_profit">net_profit</option>
                        <option value="total_orders">total_orders</option>
                        <option value="average_order_value">average_order_value</option>
                        <option value="cash_held_by_couriers">cash_held_by_couriers</option>
                      </select>
                      <Input
                        type="number"
                        value={goalDraft.target}
                        onChange={e => setGoalDraft(p => ({ ...p, target: e.target.value }))}
                        placeholder="القيمة المستهدفة"
                        className="text-[13px]"
                      />
                      <Button size="sm" onClick={saveGoals} disabled={savingKey === 'goals'}>
                        {savingKey === 'goals' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        حفظ الهدف
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  )
}
