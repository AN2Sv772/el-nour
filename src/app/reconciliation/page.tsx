"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { formatCurrency } from "@/lib/utils"
import {
  CalendarDays, Save, Loader2, AlertCircle, CheckCircle,
  PackageCheck, RotateCcw, TrendingDown, ArrowRight, Plus, X, Info,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Provisional {
  orders_count: number
  provisional_sales: number
  provisional_cogs: number
  expenses_total: number
  provisional_profit: number
}
interface SavedRec {
  id: string
  business_date: string
  orders_count: number
  provisional_sales: number
  provisional_cogs: number
  provisional_profit: number
  returned_orders_count: number
  returned_orders_value: number
  returned_products_value: number
  shipping_expenses: number
  expenses_total: number
  reconciled_profit: number
  notes: string | null
  items?: { id: string; product_id: string; quantity_returned: number; unit_cost: number; value: number }[]
}
interface ReturnItem {
  product_id: string
  name: string
  quantity_returned: number
  unit_cost: number
}

export default function ReconciliationPage() {
  const [date, setDate] = useState(() => {
    // Business timezone Africa/Cairo
    const now = new Date()
    const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }))
    return cairo.toISOString().slice(0, 10)
  })
  const [loading, setLoading] = useState(true)
  const [provisional, setProvisional] = useState<Provisional | null>(null)
  const [shippingEstimate, setShippingEstimate] = useState(0)
  const [saved, setSaved] = useState<SavedRec | null>(null)

  const [returnedOrdersCount, setReturnedOrdersCount] = useState(0)
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; cost_price: number | null; stock_quantity: number }[]>([])
  const [searching, setSearching] = useState(false)
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Recent list
  const [recent, setRecent] = useState<SavedRec[]>([])

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/reconciliation?date=${d}`)
      if (res.ok) {
        const body = await res.json()
        setProvisional(body.provisional)
        setShippingEstimate(body.shipping_estimate || 0)
        setSaved(body.saved || null)
        if (body.saved) {
          setReturnedOrdersCount(body.saved.returned_orders_count || 0)
          setNotes(body.saved.notes || '')
        } else {
          setReturnedOrdersCount(0)
          setNotes('')
        }
      }
    } catch {
      setMsg({ ok: false, text: 'تعذر التحميل' })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch('/api/reconciliation?list=1')
      if (res.ok) { const d = await res.json(); setRecent(d.data || []) }
    } catch {}
  }, [])

  useEffect(() => { load(date) }, [date, load])
  useEffect(() => { loadRecent() }, [loadRecent])

  // Product search
  useEffect(() => {
    if (!productSearch.trim() || productSearch.trim().length < 2) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(productSearch.trim())}&pageSize=8`)
        if (res.ok) { const d = await res.json(); setSearchResults(d.data || []) }
      } catch {}
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [productSearch])

  const addProduct = (p: { id: string; name: string; cost_price: number | null }) => {
    if (returnItems.some(i => i.product_id === p.id)) return
    setReturnItems(prev => [...prev, { product_id: p.id, name: p.name, quantity_returned: 1, unit_cost: p.cost_price ?? 0 }])
    setProductSearch('')
    setSearchResults([])
  }

  const returnedProductsValue = returnItems.reduce((s, i) => s + i.quantity_returned * i.unit_cost, 0)
  const avgOrderValue = provisional && provisional.orders_count > 0 ? provisional.provisional_sales / provisional.orders_count : 0
  const returnedOrdersValue = returnedOrdersCount * avgOrderValue
  const reconciledProfit = provisional
    ? provisional.provisional_profit - returnedOrdersValue + returnedProductsValue
    : 0

  const handleConfirm = async () => {
    if (saving) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_date: date,
          returned_orders_count: returnedOrdersCount,
          items: returnItems.map(i => ({ product_id: i.product_id, quantity_returned: i.quantity_returned })),
          notes,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) {
        setMsg({ ok: false, text: d.error || 'فشل حفظ التسوية' })
      } else {
        setMsg({ ok: true, text: `تمت تسوية يوم ${date} بنجاح ✓` })
        await load(date)
        await loadRecent()
      }
    } catch {
      setMsg({ ok: false, text: 'تعذر الوصول للخادم' })
    }
    setSaving(false)
  }

  const handleReopenEdit = async () => {
    if (!saved || saving) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(`/api/reconciliation?id=${saved.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returned_orders_count: returnedOrdersCount, notes }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) {
        setMsg({ ok: false, text: d.error || 'فشل التعديل' })
      } else {
        setMsg({ ok: true, text: 'تم تعديل التسوية وحفظ سجل التغيير ✓' })
        await load(date)
        await loadRecent()
      }
    } catch {
      setMsg({ ok: false, text: 'تعذر الوصول للخادم' })
    }
    setSaving(false)
  }

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-4xl">
        <PageHeader
          icon={PackageCheck}
          title="التسوية اليومية"
          description="أغلق يومك: سجّل الإرجاعات الفعلية ليتم استرجاع المخزون وتعديل الأرباح."
          actions={
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input id="reconciliation-date" type="date" aria-label="تاريخ التسوية" value={date} onChange={e => setDate(e.target.value)} className="w-44" />
            </div>
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

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : (
          <>
            {/* ─── Provisional (live from DB) ─── */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  أرقام اليوم الأولية — {date}
                </CardTitle>
                <CardDescription className="text-xs">
                  محسوبة من قاعدة البيانات مباشرة (الطلبات غير الملغاة). ليست ربحًا نهائيًا حتى التسوية.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-[11px] text-muted-foreground">عدد الطلبات</p>
                    <p className="text-xl font-bold">{provisional?.orders_count ?? 0}</p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-[11px] text-muted-foreground">المبيعات الأولية</p>
                    <p className="text-xl font-bold">{formatCurrency(provisional?.provisional_sales ?? 0)}</p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-[11px] text-muted-foreground">تكلفة المنتجات (تاريخية)</p>
                    <p className="text-xl font-bold">{formatCurrency(provisional?.provisional_cogs ?? 0)}</p>
                  </div>
                  <div className="rounded-xl border bg-primary/5 p-3 border-primary/20">
                    <p className="text-[11px] text-muted-foreground">الربح الأولي</p>
                    <p className="text-xl font-bold text-primary">{formatCurrency(provisional?.provisional_profit ?? 0)}</p>
                  </div>
                </div>
                {shippingEstimate > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    تنبيه: لا توجد مصروفات شحن مسجّلة لهذا اليوم — التقدير ≈ {formatCurrency(shippingEstimate)} ({provisional?.orders_count} طلب × رسوم افتراضية). أضف مصروف شحن حقيقي من صفحة التقارير ليكون الحساب دقيقًا.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ─── Returns entry ─── */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-muted-foreground" />
                  {saved ? 'تعديل التسوية المحفوظة' : 'إدخال الإرجاعات الفعلية'}
                </CardTitle>
                {saved && (
                  <CardDescription className="text-xs">
                    هذه التسوية محفوظة — أي تعديل يُسجَّل في سجل التدقيق مع من قام به ومتى.
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium" htmlFor="reconciliation-returned-orders">عدد الطلبات المرتجعة (تقدير الإيراد المرتجع = العدد × متوسط قيمة الطلب)</Label>
                  <Input
                    id="reconciliation-returned-orders"
                    type="number" min="0" value={returnedOrdersCount}
                    onChange={e => setReturnedOrdersCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-40 h-9 mt-1"
                  />
                  {returnedOrdersCount > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      تقديري: {formatCurrency(returnedOrdersValue)} — حدد المنتجات المستلمة فعليًا أدناه لاسترجاع المخزون بدقة.
                    </p>
                  )}
                </div>

                <Separator />

                {/* Product picker */}
                <div>
                  <Label className="text-xs font-medium" htmlFor="reconciliation-product-search">المنتجات المستلمة فعليًا في المخزن</Label>
                  <div className="relative mt-1">
                    <Input
                      id="reconciliation-product-search"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="ابحث عن منتج لإضافته…"
                      className="h-9 text-sm"
                    />
                    {searching && <Loader2 className="h-4 w-4 animate-spin absolute left-3 top-2.5 text-muted-foreground" />}
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-xl border bg-card shadow-md max-h-52 overflow-y-auto">
                        {searchResults.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addProduct(p)}
                            className="w-full text-right px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between"
                          >
                            <span className="truncate">{p.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 mr-2">متاح: {p.stock_quantity}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {returnItems.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {returnItems.map(item => (
                        <div key={item.product_id} className="flex items-center gap-2 rounded-xl border p-2.5">
                          <span className="text-sm flex-1 truncate">{item.name}</span>
                          <Input
                            type="number" min="1"
                            value={item.quantity_returned}
                            onChange={e => setReturnItems(prev => prev.map(x =>
                              x.product_id === item.product_id ? { ...x, quantity_returned: Math.max(1, parseInt(e.target.value) || 1) } : x
                            ))}
                            className="w-20 h-8 text-sm"
                            aria-label="الكمية المرتجعة"
                          />
                          <span className="text-xs text-muted-foreground w-24 text-left shrink-0">
                            {formatCurrency(item.quantity_returned * item.unit_cost)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setReturnItems(prev => prev.filter(x => x.product_id !== item.product_id))}
                            className="text-destructive/60 hover:text-destructive p-1"
                            aria-label="إزالة"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        قيمة المنتجات المرتجعة (تعود للمخزون): <span className="font-semibold text-foreground">{formatCurrency(returnedProductsValue)}</span>
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-medium" htmlFor="reconciliation-notes">ملاحظات</Label>
                  <Textarea id="reconciliation-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 text-sm" placeholder="اختياري…" />
                </div>

                {/* Financial impact review */}
                <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">الربح الأولي</span><span>{formatCurrency(provisional?.provisional_profit ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">− إيراد الطلبات المرتجعة (تقديري)</span><span className="text-destructive">{formatCurrency(returnedOrdersValue)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">+ قيمة المنتجات المستلمة (تعود للمخزون)</span><span className="text-emerald-600">{formatCurrency(returnedProductsValue)}</span></div>
                  <Separator />
                  <div className="flex justify-between font-bold">
                    <span>الربح بعد التسوية</span>
                    <span className={reconciledProfit < 0 ? 'text-destructive' : 'text-primary'}>{formatCurrency(reconciledProfit)}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground pt-1">
                    ملاحظة محاسبية: الطلبات غير المُسلَّمة التي لم تُستلم منتجاتها بعد تُعدّ «قيد التسوية» — لا يُسترجع مخزونها حتى الاستلام الفعلي.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  {saved ? (
                    <Button onClick={handleReopenEdit} disabled={saving} className="gap-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      حفظ التعديل
                    </Button>
                  ) : (
                    <Button onClick={handleConfirm} disabled={saving} className="gap-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      تأكيد تسوية اليوم
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ─── Recent ─── */}
            {recent.length > 0 && (
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">آخر التسويات</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-xs text-muted-foreground">
                          <th className="text-right font-medium px-3 py-2">التاريخ</th>
                          <th className="text-center font-medium px-3 py-2">مرتجعات</th>
                          <th className="text-center font-medium px-3 py-2">قيمة المرتجع</th>
                          <th className="text-left font-medium px-3 py-2">الربح بعد التسوية</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map(r => (
                          <tr key={r.id} className="border-t border-border/40">
                            <td className="px-3 py-2">{r.business_date}</td>
                            <td className="px-3 py-2 text-center">{r.returned_orders_count}</td>
                            <td className="px-3 py-2 text-center">{formatCurrency(r.returned_orders_value)}</td>
                            <td className="px-3 py-2 text-left font-semibold">{formatCurrency(r.reconciled_profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
