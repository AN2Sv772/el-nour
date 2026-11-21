"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useState, useEffect, useCallback } from "react"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLanguage } from "@/lib/i18n/language"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Building, Link, Save, Loader2, AlertTriangle, CheckCircle,
  XCircle, RefreshCw, Eye, EyeOff, QrCode, BookOpen, Plus, Trash2,
  Clock, CheckCheck, X, Plug,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface EasyOrdersState {
  api_key: string; webhook_secret: string; is_connected: boolean; api_key_masked: string | null; has_api_key: boolean; store_id: string | null;
  last_sync_at: string | null; last_sync_status: string | null; total_imported_orders: number; sync_logs: SyncLog[];
}
interface SyncLog { id: string; sync_type: string; status: string; orders_imported: number; orders_updated: number; created_at: string }
interface ConfirmationState { enabled: boolean; message_template: string; confirmation_timeout_hours: number; reminder_enabled: boolean; reminder_interval_hours: number; max_reminders: number }
interface ConfirmationStats { awaiting: number; confirmed: number; cancelled: number; modification: number; expired: number; human_review: number; confirmation_rate: number }
interface RecentConfirmation { id: string; status: string; customer_phone: string; created_at: string; reminder_count: number; orders: { order_number: string } | null }
interface KnowledgeEntry { id: string; category: string; question: string | null; answer: string; is_active: boolean }

const CONF_STATUS: Record<string, { text: string; cls: string }> = {
  awaiting_confirmation: { text: "بانتظار", cls: "bg-amber-100 text-amber-700" },
  confirmed: { text: "مؤكد", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { text: "ملغي", cls: "bg-red-100 text-red-700" },
  modification_requested: { text: "تعديل", cls: "bg-blue-100 text-blue-700" },
  expired: { text: "منتهي", cls: "bg-gray-100 text-gray-500" },
  human_review: { text: "مراجعة", cls: "bg-purple-100 text-purple-700" },
}

export default function IntegrationsPage() {
  const { direction } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // EasyOrders
  const [eo, setEo] = useState<EasyOrdersState>({ api_key: "", webhook_secret: "", is_connected: false, api_key_masked: null, has_api_key: false, store_id: null, last_sync_at: null, last_sync_status: null, total_imported_orders: 0, sync_logs: [] })
  const [eoTesting, setEoTesting] = useState(false)
  const [eoTestMsg, setEoTestMsg] = useState("")
  const [eoTestOk, setEoTestOk] = useState(false)
  const [eoSyncing, setEoSyncing] = useState(false)
  const [showEoKey, setShowEoKey] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [importTesting, setImportTesting] = useState(false)
  const [importTestMsg, setImportTestMsg] = useState("")
  const [importTestOk, setImportTestOk] = useState(false)
  const [webhookAttempts, setWebhookAttempts] = useState<{ id: string; type: string; status: string; created_at: string }[]>([])
  const [queueStats, setQueueStats] = useState<{ pending: number; processing: number; processed: number; failed: number; dead_letter: number } | null>(null)
  const [backfill, setBackfill] = useState<{ status: string; cursor: number; maxId: number | null; imported: number; skipped: number; failed: number; remaining: number | null; lastError: string | null } | null>(null)
  const [backfillBusy, setBackfillBusy] = useState(false)

  // Order Confirmation
  const [oc, setOc] = useState<ConfirmationState>({ enabled: true, message_template: "", confirmation_timeout_hours: 24, reminder_enabled: true, reminder_interval_hours: 6, max_reminders: 2 })
  const [ocStats, setOcStats] = useState<ConfirmationStats>({ awaiting: 0, confirmed: 0, cancelled: 0, modification: 0, expired: 0, human_review: 0, confirmation_rate: 0 })
  const [ocRecent, setOcRecent] = useState<RecentConfirmation[]>([])
  const [ocSaving, setOcSaving] = useState(false)
  const [ocSaved, setOcSaved] = useState(false)

  // Knowledge
  const [kb, setKb] = useState<KnowledgeEntry[]>([])
  const [newKb, setNewKb] = useState({ category: "faq", question: "", answer: "", keywords: "" })

  // ─── Load ────────────────────────────────────────────────────────────────

  const loadEO = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/easyorders")
      if (res.ok) { const d = await res.json(); if (d.config) setEo(p => ({ ...p, ...d.config, sync_logs: d.sync_logs || [] })) }
    } catch {}
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWebhookUrl(`${window.location.origin}/api/integrations/easyorders/webhook`)
    }
  }, [])

  const loadAttempts = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/easyorders/webhook-attempts")
      if (res.ok) { const d = await res.json(); setWebhookAttempts(d.attempts || []) }
    } catch {}
  }, [])

  useEffect(() => { loadAttempts() }, [loadAttempts])

  const loadQueueAndBackfill = useCallback(async () => {
    try {
      const [qRes, bRes] = await Promise.all([
        fetch('/api/integrations/easyorders/process-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) }),
        fetch('/api/integrations/easyorders/backfill'),
      ])
      if (qRes.ok) { const d = await qRes.json(); setQueueStats(d.stats) }
      if (bRes.ok) { const d = await bRes.json(); setBackfill(d.status) }
    } catch {}
  }, [])

  useEffect(() => { loadQueueAndBackfill() }, [loadQueueAndBackfill])

  const startBackfill = async () => {
    if (backfillBusy) return
    setBackfillBusy(true)
    try {
      const res = await fetch('/api/integrations/easyorders/backfill', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      setEoTestOk(!!d.success); setEoTestMsg(d.success ? (d.message || 'بدأ الاستخراج') : (d.error || 'فشل البدء'))
      await loadQueueAndBackfill()
    } catch { setEoTestOk(false); setEoTestMsg('تعذر الوصول للخادم') }
    setBackfillBusy(false)
  }

  const retryDeadLetters = async () => {
    if (backfillBusy) return
    setBackfillBusy(true)
    try {
      const res = await fetch('/api/integrations/easyorders/process-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry_dead_letters' }) })
      const d = await res.json().catch(() => ({}))
      setEoTestOk(!!d.success); setEoTestMsg(d.success ? 'أعيد جدولة الأحداث الفاشلة ومعالجتها' : (d.error || 'فشل'))
      await loadQueueAndBackfill()
      await loadAttempts()
    } catch { setEoTestOk(false); setEoTestMsg('تعذر الوصول للخادم') }
    setBackfillBusy(false)
  }

  const runImportTest = async () => {
    if (importTesting) return
    setImportTesting(true); setImportTestMsg(""); setImportTestOk(false)
    try {
      const res = await fetch("/api/integrations/easyorders/import-test", { method: "POST" })
      const d = await res.json().catch(() => ({ error: "استجابة غير صالحة" }))
      setImportTestOk(!!d.success)
      setImportTestMsg(d.success ? `نجح ✓ — رقم الطلب: ${d.order?.order_number}` : (d.error || "فشل الاختبار"))
      if (d.success) { await loadEO(); await loadAttempts() }
    } catch {
      setImportTestOk(false); setImportTestMsg("تعذر الوصول للخادم")
    }
    setImportTesting(false)
  }

  const loadOC = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/order-confirmation")
      if (res.ok) { const d = await res.json(); if (d.settings) setOc(d.settings); if (d.stats) setOcStats(d.stats); if (d.recent) setOcRecent(d.recent) }
    } catch {}
  }, [])

  const loadKB = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/knowledge-base")
      if (res.ok) { const d = await res.json(); setKb(d.entries || []) }
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadEO(), loadOC(), loadKB()]).finally(() => setLoading(false))
  }, [loadEO, loadOC, loadKB])

  // ─── Actions ────────────────────────────────────────────────────────────

  const saveEO = async () => {
    if (saving) return
    setSaving(true); setEoTestMsg(""); setEoTestOk(false)
    try {
      const res = await fetch("/api/integrations/easyorders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: eo.api_key?.trim() || undefined,
          webhook_secret: eo.webhook_secret?.trim() || undefined,
        }),
      })
      const d = await res.json().catch(() => ({ error: "استجابة غير صالحة من الخادم" }))
      if (!res.ok || !d.success) {
        setEoTestOk(false)
        setEoTestMsg(d.error || "فشل الحفظ")
      } else {
        setEoTestOk(true)
        setEoTestMsg("تم الحفظ بنجاح ✓ — اضغط اختبار للتحقق من الاتصال")
        // Clear the secret field after save (it's stored encrypted)
        setEo(p => ({ ...p, webhook_secret: "" }))
        await loadEO()
      }
    } catch {
      setEoTestOk(false)
      setEoTestMsg("تعذر الوصول للخادم — تحقق من اتصالك بالإنترنت")
    }
    setSaving(false)
  }

  const testEO = async () => {
    if (eoTesting) return // prevent duplicate simultaneous tests
    setEoTesting(true); setEoTestMsg(""); setEoTestOk(false)
    try {
      const res = await fetch("/api/integrations/easyorders/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(eo.api_key ? { api_key: eo.api_key } : {}) })
      const d = await res.json().catch(() => ({ success: false, error: "استجابة غير صالحة من الخادم" }))
      setEoTestOk(!!d.success)
      setEoTestMsg(d.success ? `تم الاتصال بنجاح${d.store?.id ? ` — المتجر: ${d.store.id.slice(0, 8)}…` : ""}` : (d.error || "فشل الاختبار"))
      if (d.success) await loadEO()
    } catch {
      setEoTestOk(false); setEoTestMsg("تعذر الوصول للخادم — تحقق من اتصالك بالإنترنت")
    }
    setEoTesting(false)
  }

  const syncEO = async () => {
    if (eoSyncing) return
    setEoSyncing(true); setEoTestMsg(""); setEoTestOk(false)
    try {
      const res = await fetch("/api/integrations/easyorders/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      const d = await res.json().catch(() => ({ error: "استجابة غير صالحة من الخادم" }))
      setEoTestOk(!!d.success)
      setEoTestMsg(d.success ? (d.message || "تم التحقق") : (d.error || "فشلت المزامنة"))
      await loadEO()
    } catch {
      setEoTestOk(false); setEoTestMsg("تعذر الوصول للخادم")
    }
    setEoSyncing(false)
  }

  const saveOC = async () => {
    setOcSaving(true); setOcSaved(false)
    const res = await fetch("/api/integrations/order-confirmation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(oc) })
    if (res.ok) { setOcSaved(true); setTimeout(() => setOcSaved(false), 3000) }
    setOcSaving(false)
  }

  const addKB = async () => {
    if (!newKb.answer.trim()) return
    await fetch("/api/integrations/knowledge-base", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newKb) })
    setNewKb({ category: "faq", question: "", answer: "", keywords: "" }); await loadKB()
  }

  const delKB = async (id: string) => {
    if (!confirm("حذف؟")) return
    await fetch(`/api/integrations/knowledge-base?id=${id}`, { method: "DELETE" }); await loadKB()
  }

  // ─── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-4 max-w-5xl">
          {/* Heading in the loading state too (F-018). */}
          <h1 className="sr-only">التكاملات</h1>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-5xl">
        <PageHeader
          icon={Plug}
          title="التكاملات"
          description="ربط المتجر وقاعدة المعرفة بالمصدر."
        />

        <Tabs defaultValue="easyorders" dir={direction}>
          <TabsList className="grid w-full grid-cols-3 rounded-lg">
            <TabsTrigger value="easyorders" className="gap-1.5 text-xs"><Link className="h-3.5 w-3.5" />EasyOrders</TabsTrigger>
            <TabsTrigger value="confirmations" className="gap-1.5 text-xs"><CheckCheck className="h-3.5 w-3.5" />التأكيدات</TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-1.5 text-xs"><BookOpen className="h-3.5 w-3.5" />المعرفة</TabsTrigger>
          </TabsList>

          {/* ─── EasyOrders ──────────────────────────────────────────────────── */}
          <TabsContent value="easyorders" className="space-y-4 mt-4">
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">EasyOrders</CardTitle>
                  <Badge variant="outline" className={eo.is_connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-500 border-gray-200"}>
                    {eo.is_connected ? "متصل" : "غير متصل"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  {/* The label was not bound to the input, so the field had
                      no accessible name (F-018). */}
                  <Label className="form-label" htmlFor="easyorders-api-key">مفتاح API</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input id="easyorders-api-key" type={showEoKey ? "text" : "password"} value={eo.api_key} onChange={e => setEo(p => ({ ...p, api_key: e.target.value }))} placeholder={eo.has_api_key ? eo.api_key_masked || "••••" : "أدخل المفتاح"} className="input pl-10" dir="ltr" />
                      <button
                        type="button"
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 -m-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setShowEoKey(!showEoKey)}
                        aria-label={showEoKey ? "إخفاء مفتاح API" : "إظهار مفتاح API"}
                        aria-pressed={showEoKey}
                      >
                        {showEoKey ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={testEO} disabled={eoTesting} className="gap-1.5 rounded-lg text-xs">
                    {eoTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    اختبار
                  </Button>
                  {eoTestMsg && (
                    <span className={cn("text-xs flex items-center gap-1", eoTestOk ? "text-emerald-600" : "text-destructive")}>
                      {eoTestOk ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {eoTestMsg}
                    </span>
                  )}
                </div>

                {/* Webhook configuration */}
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold">الطلبات تصل تلقائياً عبر Webhook</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    في لوحة EasyOrders البائع: <span className="font-medium">Public API → Webhooks → Create Webhook</span>،
                    الصق الرابط التالي ثم انسخ الـ Secret المُولَّد وأدخله في الحقل أدناه واحفظ.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input id="easyorders-webhook-url" readOnly value={webhookUrl} aria-label="رابط Webhook" dir="ltr" className="input h-8 text-[11px] font-mono flex-1 bg-background" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-[11px] shrink-0"
                      onClick={async () => { try { await navigator.clipboard.writeText(webhookUrl); setCopiedWebhook(true); setTimeout(() => setCopiedWebhook(false), 2000) } catch {} }}
                    >
                      {copiedWebhook ? "✓ تم النسخ" : "نسخ"}
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label className="form-label text-[11px]" htmlFor="easyorders-webhook-secret">Webhook Secret (من EasyOrders)</Label>
                    <Input
                      id="easyorders-webhook-secret"
                      type="password"
                      value={eo.webhook_secret}
                      onChange={e => setEo(p => ({ ...p, webhook_secret: e.target.value }))}
                      placeholder="الصق الـ Secret المُولَّد من EasyOrders"
                      className="input h-9 text-xs"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEO} disabled={saving} className="gap-1.5 rounded-lg text-xs">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    حفظ
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncEO} disabled={eoSyncing || !eo.has_api_key} className="gap-1.5 rounded-lg text-xs">
                    {eoSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    تحقق
                  </Button>
                </div>

                {eo.is_connected && (
                  <div className="pt-3 border-t border-border/40">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>مستورد: <span className="font-semibold text-foreground">{eo.total_imported_orders}</span></span>
                      {eo.last_sync_at && <span>آخر مزامنة: <span className="font-medium">{new Date(eo.last_sync_at).toLocaleString("ar-EG")}</span></span>}
                    </div>
                  </div>
                )}

                {/* Import pipeline test */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">اختبار خط الاستيراد</p>
                      <p className="text-[10px] text-muted-foreground">ينشئ طلب اختبار عبر المسار الحقيقي للتأكد من صحة قاعدة البيانات والصلاحيات</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={runImportTest} disabled={importTesting} className="gap-1.5 rounded-lg text-xs shrink-0">
                      {importTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                      تشغيل
                    </Button>
                  </div>
                  {importTestMsg && (
                    <p className={cn("text-xs flex items-start gap-1", importTestOk ? "text-emerald-600" : "text-destructive")}>
                      {importTestOk ? <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />} {importTestMsg}
                    </p>
                  )}
                </div>

                {/* Webhook attempts diagnostics */}
                {webhookAttempts.length > 0 && (
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <p className="text-xs font-semibold">آخر محاولات الـ Webhook</p>
                    {webhookAttempts.slice(0, 5).map(a => (
                      <div key={a.id} className="flex items-center justify-between text-[10px] py-1 border-b border-border/30 last:border-0">
                        <span className={cn("font-medium", a.type === "webhook_rejected" ? "text-destructive" : a.type === "webhook_processed" ? "text-emerald-600" : "text-muted-foreground")}>
                          {a.type === "webhook_rejected" ? "مرفوض (Secret خاطئ)" : a.type === "webhook_processed" ? "عولج ✓" : a.type === "webhook_failed" ? "فشل المعالجة" : "وصل"}
                        </span>
                        <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString("ar-EG")}</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground pt-1">إذا ظهر «مرفوض» بعد طلب حقيقي → الـ Secret المحفوظ لا يطابق — أعد لصقه من EasyOrders واحفظ.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Automatic synchronization health ─── */}
            <Card className="rounded-xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>المزامنة التلقائية</span>
                  <button onClick={() => { loadQueueAndBackfill(); loadAttempts() }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 py-1 -my-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <RefreshCw className="h-3 w-3" aria-hidden="true" /> تحديث
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Event queue */}
                {queueStats && (
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">قيد الانتظار</p>
                      <p className="text-lg font-bold">{queueStats.pending}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">عولجت</p>
                      <p className="text-lg font-bold text-emerald-600">{queueStats.processed}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">فشلت (تعاد)</p>
                      <p className={cn("text-lg font-bold", queueStats.failed > 0 ? "text-amber-600" : "")}>{queueStats.failed}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">متعذرة نهائيًا</p>
                      <p className={cn("text-lg font-bold", queueStats.dead_letter > 0 ? "text-destructive" : "")}>{queueStats.dead_letter}</p>
                    </div>
                  </div>
                )}
                {queueStats && queueStats.dead_letter > 0 && (
                  <Button variant="outline" size="sm" onClick={retryDeadLetters} disabled={backfillBusy} className="w-full gap-1.5 text-xs">
                    <RefreshCw className="h-3.5 w-3.5" /> إعادة محاولة الأحداث المتعذرة ({queueStats.dead_letter})
                  </Button>
                )}

                {/* Historical backfill */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">الاستخراج التاريخي للطلبات القديمة</p>
                    {backfill && (
                      <Badge variant="outline" className={cn(
                        "text-[10px] border-transparent",
                        backfill.status === 'done' ? "bg-emerald-50 text-emerald-700" :
                        backfill.status === 'running' ? "bg-blue-50 text-blue-700" :
                        "bg-gray-50 text-gray-500"
                      )}>
                        {backfill.status === 'done' ? 'مكتمل ✓' : backfill.status === 'running' ? 'يعمل…' : 'غير مبدوء'}
                      </Badge>
                    )}
                  </div>
                  {backfill && backfill.maxId ? (
                    <>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(100, Math.round((backfill.cursor / Math.max(1, backfill.maxId)) * 100))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{backfill.cursor} / {backfill.maxId}</span>
                        <span>مستورد: <span className="font-semibold text-foreground">{backfill.imported}</span> • موجود مسبقًا: {backfill.skipped} • فاشل: {backfill.failed}</span>
                      </div>
                      {backfill.lastError && <p className="text-[10px] text-destructive">{backfill.lastError}</p>}
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      يستخرج كل طلباتك القديمة من EasyOrders تلقائيًا عبر المسار الرسمي (short_id التسلسلي) — ~30 طلب/دقيقة بسبب حد المعدل (40/دقيقة).
                    </p>
                  )}
                  {(!backfill || backfill.status !== 'done') && (
                    <Button size="sm" onClick={startBackfill} disabled={backfillBusy} className="w-full gap-1.5 text-xs">
                      {backfillBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      {backfill?.status === 'running' ? 'متابعة الآن' : 'بدء الاستخراج التاريخي'}
                    </Button>
                  )}
                </div>

                <p className="text-[10px] text-muted-foreground">
                  الطلبات الجديدة تصل تلقائيًا عبر Webhook (طابور دائم بإعادة محاولة تلقائية). Cron يعمل كل دقيقة لمعالجة الطابور وتقديم الاستخراج التاريخي.
                </p>
              </CardContent>
            </Card>

            {eo.sync_logs.length > 0 && (
              <Card className="rounded-xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm">سجل المزامنة</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {eo.sync_logs.slice(0, 5).map(log => (
                      <div key={log.id} className="flex items-center justify-between py-1.5 px-2 rounded-md text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={log.status === "success" ? "bg-emerald-50 text-emerald-600 text-[10px]" : "bg-red-50 text-red-600 text-[10px]"}>
                            {log.status === "success" ? "ناجح" : log.status}
                          </Badge>
                          <span className="text-muted-foreground">{new Date(log.created_at).toLocaleDateString("ar-EG")}</span>
                        </div>
                        <span className="text-muted-foreground">{log.orders_imported} مستورد</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── Order Confirmations ────────────────────────────────────────── */}
          <TabsContent value="confirmations" className="space-y-4 mt-4">
            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { l: "بانتظار", v: ocStats.awaiting, c: "text-amber-600" },
                { l: "مؤكد", v: ocStats.confirmed, c: "text-emerald-600" },
                { l: "إلغاء", v: ocStats.cancelled, c: "text-red-600" },
                { l: "مراجعة", v: ocStats.human_review, c: "text-purple-600" },
              ].map(s => (
                <div key={s.l} className="rounded-xl border bg-card p-3.5 text-center">
                  <p className="text-[11px] text-muted-foreground">{s.l}</p>
                  <p className={cn("text-2xl font-bold", s.c)}>{s.v}</p>
                </div>
              ))}
            </div>

            {/* Settings */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">إعدادات تأكيد الطلبات</CardTitle>
                  <Switch checked={oc.enabled} onCheckedChange={c => setOc(p => ({ ...p, enabled: c }))} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="form-label" htmlFor="confirmation-message-template">قالب الرسالة</Label>
                  <Textarea id="confirmation-message-template" value={oc.message_template} onChange={e => setOc(p => ({ ...p, message_template: e.target.value }))} rows={14} className="input text-xs font-mono" dir="rtl" />
                  <p className="text-[10px] text-muted-foreground">المتغيرات: {'{{customer_name}} {{order_number}} {{products}} {{subtotal}} {{shipping}} {{discount}} {{total}} {{delivery_address}}'}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><Label className="form-label text-[11px]" htmlFor="confirmation-timeout-hours">مدة التأكيد (ساعات)</Label><Input id="confirmation-timeout-hours" type="number" className="input h-9 text-xs" value={oc.confirmation_timeout_hours} onChange={e => setOc(p => ({ ...p, confirmation_timeout_hours: parseInt(e.target.value) || 24 }))} /></div>
                  <div><Label className="form-label text-[11px]" htmlFor="reminder-interval-hours">فترة التذكير (ساعات)</Label><Input id="reminder-interval-hours" type="number" className="input h-9 text-xs" value={oc.reminder_interval_hours} onChange={e => setOc(p => ({ ...p, reminder_interval_hours: parseInt(e.target.value) || 6 }))} /></div>
                  <div><Label className="form-label text-[11px]" htmlFor="max-reminders">أقصى تذكيرات</Label><Input id="max-reminders" type="number" className="input h-9 text-xs" value={oc.max_reminders} onChange={e => setOc(p => ({ ...p, max_reminders: parseInt(e.target.value) || 2 }))} /></div>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border">
                  <Label className="text-xs font-medium" htmlFor="confirmation-reminder-enabled">تذكير تلقائي</Label>
                  <Switch id="confirmation-reminder-enabled" checked={oc.reminder_enabled} onCheckedChange={c => setOc(p => ({ ...p, reminder_enabled: c }))} />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={saveOC} disabled={ocSaving} className="gap-1.5 rounded-lg text-xs">
                    {ocSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} حفظ
                  </Button>
                </div>
                {ocSaved && <p className="text-xs text-emerald-600 text-right">✓ تم الحفظ</p>}
              </CardContent>
            </Card>

            {/* Recent */}
            {ocRecent.length > 0 && (
              <Card className="rounded-xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm">آخر التأكيدات</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {ocRecent.slice(0, 8).map(r => {
                      const s = CONF_STATUS[r.status] || { text: r.status, cls: "bg-gray-100" }
                      return (
                        <div key={r.id} className="flex items-center justify-between py-1.5 px-2 rounded-md text-xs">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn(s.cls, "border-transparent text-[10px]")}>{s.text}</Badge>
                            <span className="font-mono text-muted-foreground flex-1 truncate">{r.orders?.order_number || "—"}</span>
                          </div>
                          <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ar-EG")}</span>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── Knowledge Base ──────────────────────────────────────────────── */}
          <TabsContent value="knowledge" className="space-y-4 mt-4">
            <Card className="rounded-xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">إضافة معلومة</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* A placeholder is not a label: it disappears as soon as
                      the operator types (F-018). */}
                  <Input id="kb-question" aria-label="السؤال (اختياري)" placeholder="السؤال (اختياري)" value={newKb.question} onChange={e => setNewKb(p => ({ ...p, question: e.target.value }))} className="input h-9 text-xs" />
                  <Input id="kb-keywords" aria-label="كلمات مفتاحية (فواصل)" placeholder="كلمات مفتاحية (فواصل)" value={newKb.keywords} onChange={e => setNewKb(p => ({ ...p, keywords: e.target.value }))} className="input h-9 text-xs" />
                </div>
                <Textarea id="kb-answer" aria-label="الجواب *" placeholder="الجواب *" value={newKb.answer} onChange={e => setNewKb(p => ({ ...p, answer: e.target.value }))} rows={2} className="input text-xs" />
                <Button size="sm" onClick={addKB} disabled={!newKb.answer.trim()} className="gap-1.5 rounded-lg text-xs">
                  <Plus className="h-3.5 w-3.5" /> إضافة
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">قاعدة المعرفة ({kb.length})</CardTitle></CardHeader>
              <CardContent>
                {kb.length === 0 ? (
                  <p className="text-center text-muted-foreground text-xs py-6">لا توجد إدخالات</p>
                ) : (
                  <div className="space-y-1.5">
                    {kb.map(e => (
                      <div key={e.id} className="flex items-start justify-between py-2 px-2.5 rounded-lg border gap-2 text-xs">
                        <div className="min-w-0 flex-1">
                          {e.question && <p className="font-medium">{e.question}</p>}
                          <p className="text-muted-foreground">{e.answer}</p>
                        </div>
                        <button onClick={() => delKB(e.id)} className="text-destructive/60 hover:text-destructive shrink-0 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
