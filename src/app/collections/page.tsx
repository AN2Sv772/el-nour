"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { formatCurrency, formatDate, cn } from "@/lib/utils"
import {
  Banknote, Plus, Loader2, CheckCircle, AlertCircle,
  Trash2, X, Search, TrendingUp, TrendingDown, Wallet,
} from "lucide-react"

interface DeductionRow { label: string; amount: number }
interface Allocation { order_id: string; allocated_amount: number; orders?: { order_number: string; total_amount: number; status: string } | null }
interface Batch {
  id: string
  company_name: string
  batch_reference: string | null
  transfer_date: string
  orders_date_from: string | null
  orders_date_to: string | null
  expected_amount: number
  received_amount: number
  status: string
  notes: string | null
  deductions: { id: string; label: string; amount: number }[] | null
  allocations: Allocation[] | null
}
interface Totals {
  batches: number; matched: number; unmatched: number
  total_received: number; total_expected: number; outstanding: number
}
interface EligibleOrder {
  id: string; order_number: string; total_amount: number; status: string; created_at: string
}

export default function CollectionsPage() {
  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState<Batch[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [company, setCompany] = useState('')
  const [batchRef, setBatchRef] = useState('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [received, setReceived] = useState('')
  const [notes, setNotes] = useState('')
  const [deductions, setDeductions] = useState<DeductionRow[]>([])
  const [dedLabel, setDedLabel] = useState('')
  const [dedAmount, setDedAmount] = useState('')

  const [eligible, setEligible] = useState<EligibleOrder[]>([])
  const [loadingEligible, setLoadingEligible] = useState(false)
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [orderSearch, setOrderSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/collections')
      if (res.ok) { const d = await res.json(); setBatches(d.data || []); setTotals(d.totals) }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadEligible = useCallback(async () => {
    setLoadingEligible(true)
    try {
      const params = new URLSearchParams({ eligibleOrders: '1' })
      if (rangeFrom) params.set('dateFrom', rangeFrom)
      if (rangeTo) params.set('dateTo', rangeTo)
      const res = await fetch(`/api/collections?${params}`)
      if (res.ok) { const d = await res.json(); setEligible(d.data || []) }
    } catch {}
    setLoadingEligible(false)
  }, [rangeFrom, rangeTo])

  useEffect(() => {
    if (createOpen) loadEligible()
  }, [createOpen, loadEligible])

  const filteredEligible = eligible.filter(o =>
    !orderSearch || o.order_number.toLowerCase().includes(orderSearch.toLowerCase())
  )

  const selectedTotal = eligible
    .filter(o => selectedOrders.has(o.id))
    .reduce((s, o) => s + (o.total_amount || 0), 0)

  const deductionsTotal = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const expectedCalc = selectedTotal - deductionsTotal
  const receivedNum = Number(received) || 0
  const diffCalc = receivedNum - expectedCalc

  const addDeduction = () => {
    if (!dedLabel.trim() || !Number(dedAmount)) return
    setDeductions(p => [...p, { label: dedLabel.trim(), amount: Number(dedAmount) }])
    setDedLabel(''); setDedAmount('')
  }

  const resetForm = () => {
    setCompany(''); setBatchRef(''); setTransferDate(new Date().toISOString().slice(0, 10))
    setRangeFrom(''); setRangeTo(''); setReceived(''); setNotes('')
    setDeductions([]); setSelectedOrders(new Set()); setOrderSearch('')
  }

  const handleCreate = async () => {
    if (saving) return
    if (!company.trim()) { setMsg({ ok: false, text: 'اسم شركة الشحن مطلوب' }); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company,
          batch_reference: batchRef || undefined,
          transfer_date: transferDate,
          orders_date_from: rangeFrom || undefined,
          orders_date_to: rangeTo || undefined,
          order_ids: Array.from(selectedOrders),
          deductions,
          received_amount: receivedNum,
          notes: notes || undefined,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) {
        setMsg({ ok: false, text: d.error || 'فشل إنشاء الدفعة' })
      } else {
        setMsg({ ok: true, text: `تم إنشاء الدفعة ✓ — الفرق: ${formatCurrency(d.calculation?.difference ?? 0)}` })
        setCreateOpen(false); resetForm()
        await load()
      }
    } catch {
      setMsg({ ok: false, text: 'تعذر الوصول للخادم' })
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('حذف الدفعة؟ سجل التدقيق يحفظ العملية.')) return
    try {
      await fetch(`/api/collections?id=${id}`, { method: 'DELETE' })
      await load()
    } catch {}
  }

  const updateReceived = async (id: string, value: number) => {
    try {
      await fetch(`/api/collections?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received_amount: value }),
      })
      await load()
    } catch {}
  }

  const batchCalc = (b: Batch) => {
    const orders = (b.allocations || []).map(a => ({
      total_amount: a.orders?.total_amount ?? a.allocated_amount ?? 0,
      status: a.orders?.status ?? 'delivered',
    }))
    const deductions = (b.deductions || []).map(d => ({ label: d.label, amount: d.amount }))
    const gross = orders.filter(o => !['cancelled', 'returned'].includes(o.status)).reduce((s, o) => s + o.total_amount, 0)
    const dedTotal = deductions.reduce((s, d) => s + d.amount, 0)
    const expected = gross - dedTotal
    const diff = b.received_amount - expected
    return { gross, dedTotal, expected, diff, matched: Math.abs(diff) < 0.01 }
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <PageHeader
          icon={Banknote}
          title="مطابقة تحصيل شركات الشحن"
          description="سجّل كل دفعة تحويل فعلية واستعرض الفرق بين المتوقع والمستلم — النقد المستلم منفصل عن المبيعات والأرباح."
          actions={
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> دفعة تحصيل جديدة
            </Button>
          }
        />

        {msg && (
          <div className={cn(
            "flex items-center gap-2 rounded-xl border p-3 text-sm",
            msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          )} role="status">
            {msg.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{msg.text}</span>
          </div>
        )}

        {totals && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="rounded-2xl border-border"><CardContent className="p-4">
              <div className="flex items-center justify-between mb-1"><p className="text-[12px] text-muted-foreground">إجمالي المستلم فعليًا</p><Wallet className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" /></div>
              <p className="text-xl font-bold">{formatCurrency(totals.total_received)}</p>
            </CardContent></Card>
            <Card className="rounded-2xl border-border"><CardContent className="p-4">
              <div className="flex items-center justify-between mb-1"><p className="text-[12px] text-muted-foreground">إجمالي المتوقع</p><TrendingUp className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" /></div>
              <p className="text-xl font-bold">{formatCurrency(totals.total_expected)}</p>
            </CardContent></Card>
            <Card className={cn("rounded-2xl", totals.outstanding > 0.01 ? "border-amber-300/60 bg-amber-50/50" : "border-border")}><CardContent className="p-4">
              <div className="flex items-center justify-between mb-1"><p className="text-[12px] text-muted-foreground">الرصيد المستحق (لم يُستلم)</p><TrendingDown className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" /></div>
              <p className={cn("text-xl font-bold", totals.outstanding > 0.01 ? "text-amber-700" : "")}>{formatCurrency(totals.outstanding)}</p>
            </CardContent></Card>
            <Card className="rounded-2xl border-border"><CardContent className="p-4">
              <p className="text-[12px] text-muted-foreground mb-1">الدفعات</p>
              <p className="text-lg font-bold">
                <span className="text-emerald-600">{totals.matched} مطابقة</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className={cn(totals.unmatched > 0 ? 'text-destructive' : '')}>{totals.unmatched} غير مطابقة</span>
              </p>
            </CardContent></Card>
          </div>
        )}

        <Card className="rounded-2xl border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">الدفعات</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : batches.length === 0 ? (
              <div className="py-10 text-center">
                <Banknote className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">لا توجد دفعات بعد — سجّل أول دفعة تحويل من شركة الشحن</p>
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map(b => {
                  const c = batchCalc(b)
                  return (
                    <div key={b.id} className="rounded-xl border border-border p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{b.company_name}</span>
                            {b.batch_reference && <span className="text-xs text-muted-foreground font-mono" dir="ltr">#{b.batch_reference}</span>}
                            <Badge variant="outline" className={cn(
                              "text-[10px] border-transparent",
                              c.matched ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            )}>
                              {c.matched ? 'مطابقة ✓' : `فرق ${formatCurrency(c.diff)}`}
                            </Badge>
                            {b.status === 'closed' && <Badge variant="outline" className="text-[10px] border-transparent bg-gray-100 text-gray-500">مغلقة</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            تحويل: {formatDate(b.transfer_date)}
                            {b.orders_date_from && ` — يغطي طلبات: ${b.orders_date_from} ← ${b.orders_date_to}`}
                            {' • '}{(b.allocations || []).length} طلب مخصص
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(b.id)}
                          className="text-destructive hover:text-destructive/80 p-1.5 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="حذف الدفعة"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-4 mt-3 text-xs">
                        <div className="rounded-lg bg-muted/40 p-2">
                          <p className="text-muted-foreground">المتوقع</p>
                          <p className="font-semibold">{formatCurrency(c.expected)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-2">
                          <p className="text-muted-foreground">المستلم</p>
                          <Input
                            type="number" step="0.01" min="0" defaultValue={b.received_amount}
                            onBlur={e => { const v = Number(e.target.value); if (v !== b.received_amount) updateReceived(b.id, v) }}
                            className="h-7 mt-0.5 text-sm font-semibold"
                            aria-label="المبلغ المستلم"
                          />
                        </div>
                        <div className="rounded-lg bg-muted/40 p-2">
                          <p className="text-muted-foreground">استقطاعات الشركة</p>
                          <p className="font-semibold">{formatCurrency(c.dedTotal)}</p>
                        </div>
                        <div className={cn("rounded-lg p-2", c.diff < -0.01 ? "bg-amber-50" : c.diff > 0.01 ? "bg-blue-50" : "bg-emerald-50")}>
                          <p className="text-muted-foreground">الفرق</p>
                          <p className={cn("font-semibold", c.diff < -0.01 ? 'text-amber-700' : c.diff > 0.01 ? 'text-blue-700' : 'text-emerald-700')}>
                            {formatCurrency(c.diff)} {c.diff < -0.01 ? '(مستحق لنا)' : c.diff > 0.01 ? '(زائد — مراجعة)' : ''}
                          </p>
                        </div>
                      </div>

                      {(b.deductions?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {b.deductions!.map(d => (
                            <Badge key={d.id} variant="outline" className="text-[10px] border-border">
                              {d.label}: {formatCurrency(d.amount)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setCreateOpen(false)}>
            <div className="bg-card rounded-2xl border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">دفعة تحصيل جديدة</h2>
                <button onClick={() => setCreateOpen(false)} className="p-1 text-muted-foreground hover:text-foreground" aria-label="إغلاق"><X className="h-5 w-5" /></button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label className="text-xs">شركة الشحن *</Label><Input value={company} onChange={e => setCompany(e.target.value)} placeholder="مثال: بريق، ارامكس…" className="h-9 mt-1 text-sm" /></div>
                <div><Label className="text-xs">رقم الدفعة / المرجع</Label><Input value={batchRef} onChange={e => setBatchRef(e.target.value)} className="h-9 mt-1 text-sm" dir="ltr" /></div>
                <div><Label className="text-xs">تاريخ التحويل</Label><Input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} className="h-9 mt-1 text-sm" /></div>
                <div><Label className="text-xs">المبلغ المستلم فعليًا</Label><Input type="number" step="0.01" min="0" value={received} onChange={e => setReceived(e.target.value)} className="h-9 mt-1 text-sm" /></div>
                <div><Label className="text-xs">تغطي طلبات من</Label><Input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className="h-9 mt-1 text-sm" /></div>
                <div><Label className="text-xs">إلى</Label><Input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} className="h-9 mt-1 text-sm" /></div>
              </div>

              <Separator />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">الطلبات المشمولة (المخصصة مسبقًا مخفية — لا عدّ مزدوج)</Label>
                  <span className="text-xs text-muted-foreground">المحدد: {formatCurrency(selectedTotal)} ({selectedOrders.size} طلب)</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1">
                    <Search className="h-3.5 w-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" aria-hidden="true" />
                    <Input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="بحث برقم الطلب…" className="h-8 pr-8 text-xs" />
                  </div>
                  {loadingEligible && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="rounded-xl border max-h-44 overflow-y-auto">
                  {filteredEligible.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-6">
                      {loadingEligible ? 'جاري التحميل…' : 'لا توجد طلبات غير مخصصة في هذه الفترة'}
                    </p>
                  ) : filteredEligible.map(o => (
                    <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer border-b border-border/30 last:border-0">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(o.id)}
                        onChange={() => setSelectedOrders(prev => {
                          const n = new Set(prev)
                          if (n.has(o.id)) n.delete(o.id); else n.add(o.id)
                          return n
                        })}
                        className="rounded border-input"
                      />
                      <span className="font-mono" dir="ltr">{o.order_number}</span>
                      <span className="text-muted-foreground mr-auto">{formatDate(o.created_at)}</span>
                      <span className="font-semibold">{formatCurrency(o.total_amount)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="text-xs">استقطاعات شركة الشحن (منفصلة عن مصروف الشحن الخاص بك)</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={dedLabel} onChange={e => setDedLabel(e.target.value)} placeholder="الوصف — مثال: رسوم شحن الشركة" className="h-8 flex-1 text-xs" />
                  <Input type="number" step="0.01" min="0" value={dedAmount} onChange={e => setDedAmount(e.target.value)} placeholder="المبلغ" className="h-8 w-28 text-xs" />
                  <Button type="button" variant="outline" size="sm" onClick={addDeduction} className="h-8 gap-1 text-xs shrink-0"><Plus className="h-3 w-3" /> إضافة</Button>
                </div>
                {deductions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {deductions.map((d, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
                        <span>{d.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{formatCurrency(d.amount)}</span>
                          <button onClick={() => setDeductions(p => p.filter((_, j) => j !== i))} className="text-destructive/60 hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">إجمالي الطلبات المحددة</span><span>{formatCurrency(selectedTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">− استقطاعات الشركة</span><span>{formatCurrency(deductionsTotal)}</span></div>
                <Separator />
                <div className="flex justify-between font-semibold"><span>المتوقع</span><span>{formatCurrency(expectedCalc)}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الفرق (المستلم − المتوقع)</span>
                  <span className={cn("font-semibold", Math.abs(diffCalc) < 0.01 ? 'text-emerald-600' : diffCalc < 0 ? 'text-amber-600' : 'text-blue-600')}>
                    {formatCurrency(diffCalc)} {Math.abs(diffCalc) < 0.01 ? '✓ مطابقة' : diffCalc < 0 ? '(مستحق لنا)' : '(زائد)'}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-xs">ملاحظات</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 text-sm" />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)} className="text-sm">إلغاء</Button>
                <Button onClick={handleCreate} disabled={saving} className="gap-2 text-sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  حفظ الدفعة
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
