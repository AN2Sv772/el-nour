"use client"

import * as React from "react"
import { use, useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Save, Loader2, PackagePlus, PackageMinus, History, AlertCircle, CheckCircle } from "lucide-react"
import { formatCurrency, formatDateTime, cn } from "@/lib/utils"

interface ProductForEdit {
  id: string
  name: string
  name_ar: string | null
  sku: string
  category: string | null
  price: number
  cost_price: number | null
  stock_quantity: number
  low_stock_threshold: number
  track_inventory: boolean
  description: string | null
  is_active: boolean
}

interface MovementRow {
  id: string
  type: string
  quantity: number
  notes: string | null
  created_at: string
}

export default function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [product, setProduct] = useState<ProductForEdit | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Stock adjustment
  const [adjMovement, setAdjMovement] = useState<'add' | 'reduce'>('add')
  const [adjQty, setAdjQty] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [movements, setMovements] = useState<MovementRow[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { credentials: 'include' })
      if (!res.ok) throw new Error('تعذر تحميل المنتج')
      const body = await res.json()
      const found = (body.data || [])[0]
      if (!found) throw new Error('لم يتم العثور على المنتج')
      setProduct(found)

      const mvRes = await fetch(`/api/inventory/adjust?product_id=${encodeURIComponent(id)}`, { credentials: 'include' })
      if (mvRes.ok) { const d = await mvRes.json(); setMovements(d.data || []) }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'حدث خطأ' })
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!product || saving) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: product.name,
          name_ar: product.name_ar,
          sku: product.sku,
          category: product.category,
          price: Number(product.price),
          cost_price: product.cost_price === null ? null : Number(product.cost_price),
          low_stock_threshold: Number(product.low_stock_threshold) || 0,
          description: product.description,
          is_active: product.is_active,
        }),
        credentials: 'include',
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) {
        setMsg({ ok: false, text: d.error || 'فشل الحفظ' })
      } else {
        setMsg({ ok: true, text: 'تم الحفظ ✓ — تغيير التكلفة مُسجَّل في سجل التدقيق ولا يؤثر على أرباح الطلبات السابقة' })
        await load()
      }
    } catch {
      setMsg({ ok: false, text: 'تعذر الوصول للخادم' })
    }
    setSaving(false)
  }

  const handleAdjust = async () => {
    if (!product || adjusting) return
    const qty = Number(adjQty)
    if (!qty || qty <= 0) { setMsg({ ok: false, text: 'أدخل كمية صحيحة' }); return }
    setAdjusting(true); setMsg(null)
    try {
      const res = await fetch('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.id,
          quantity: qty,
          movement: adjMovement,
          reason: adjReason || undefined,
        }),
        credentials: 'include',
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) {
        setMsg({ ok: false, text: d.error || 'فشل تعديل المخزون' })
      } else {
        setMsg({ ok: true, text: `تم — المخزون: ${d.data.previous_stock} ← ${d.data.new_stock}` })
        setAdjQty(''); setAdjReason('')
        await load()
      }
    } catch {
      setMsg({ ok: false, text: 'تعذر الوصول للخادم' })
    }
    setAdjusting(false)
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-4 max-w-3xl">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </DashboardLayout>
    )
  }

  if (!product) {
    return (
      <DashboardLayout>
        <Card className="rounded-2xl border-border max-w-3xl">
          <CardContent className="py-12 text-center text-muted-foreground">
            {msg?.text || 'لم يتم العثور على المنتج'}
          </CardContent>
        </Card>
      </DashboardLayout>
    )
  }

  const lowStock = product.track_inventory && product.stock_quantity <= (product.low_stock_threshold || 5)

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <Link
            href={`/products/${product.id}`}
            className="h-9 w-9 rounded-lg border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="عودة"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{product.name}</h1>
            <p className="text-xs text-muted-foreground font-mono" dir="ltr">{product.sku}</p>
          </div>
        </div>

        {msg && (
          <div className={cn(
            "flex items-start gap-2 rounded-xl border p-3 text-sm",
            msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          )} role="status">
            {msg.ok ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        {/* ─── Basic info ─── */}
        <Card className="rounded-2xl border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">بيانات المنتج</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">الاسم (عربي)</Label>
                <Input value={product.name_ar || ''} onChange={e => setProduct(p => p ? { ...p, name_ar: e.target.value } : p)} className="h-9 mt-1 text-sm" />
              </div>
              <div>
                <Label className="text-xs">SKU</Label>
                <Input value={product.sku} onChange={e => setProduct(p => p ? { ...p, sku: e.target.value } : p)} className="h-9 mt-1 text-sm" dir="ltr" />
              </div>
              <div>
                <Label className="text-xs">سعر البيع</Label>
                <Input type="number" step="0.01" min="0" value={product.price} onChange={e => setProduct(p => p ? { ...p, price: parseFloat(e.target.value) || 0 } : p)} className="h-9 mt-1 text-sm" />
              </div>
              <div>
                <Label className="text-xs">تكلفة الوحدة (ثابتة — قابلة للتعديل)</Label>
                <Input type="number" step="0.01" min="0" value={product.cost_price ?? 0} onChange={e => setProduct(p => p ? { ...p, cost_price: parseFloat(e.target.value) || 0 } : p)} className="h-9 mt-1 text-sm" />
                <p className="text-[10px] text-muted-foreground mt-1">تُستخدم للطلبات الجديدة فقط — أرباح الطلبات السابقة محفوظة بلقطاتها التاريخية</p>
              </div>
              <div>
                <Label className="text-xs">الفئة</Label>
                <Input value={product.category || ''} onChange={e => setProduct(p => p ? { ...p, category: e.target.value } : p)} className="h-9 mt-1 text-sm" />
              </div>
              <div>
                <Label className="text-xs">حد التنبيه (مخزون منخفض)</Label>
                <Input type="number" min="0" value={product.low_stock_threshold} onChange={e => setProduct(p => p ? { ...p, low_stock_threshold: parseInt(e.target.value) || 0 } : p)} className="h-9 mt-1 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-xs">الوصف</Label>
              <Textarea value={product.description || ''} onChange={e => setProduct(p => p ? { ...p, description: e.target.value } : p)} rows={2} className="mt-1 text-sm" />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={product.is_active} onChange={e => setProduct(p => p ? { ...p, is_active: e.target.checked } : p)} className="rounded border-input" />
                منتج نشط
              </label>
              <Button onClick={handleSave} disabled={saving} className="gap-2 text-sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ─── Stock ─── */}
        <Card className="rounded-2xl border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>المخزون</span>
              <span className={cn("text-sm", lowStock ? 'text-destructive' : 'text-foreground')}>
                متاح: {product.track_inventory ? product.stock_quantity : 'غير متتبَّع'}
                {lowStock && ' ⚠ منخفض'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-32">
                <Label className="text-[10px] text-muted-foreground">نوع الحركة</Label>
                <select
                  value={adjMovement}
                  onChange={e => setAdjMovement(e.target.value as 'add' | 'reduce')}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2 text-sm mt-1"
                >
                  <option value="add">إضافة مخزون</option>
                  <option value="reduce">صرف / خصم</option>
                </select>
              </div>
              <div className="w-24">
                <Label className="text-[10px] text-muted-foreground">الكمية</Label>
                <Input type="number" min="1" value={adjQty} onChange={e => setAdjQty(e.target.value)} className="h-9 mt-1 text-sm" />
              </div>
              <div className="flex-1 min-w-[160px]">
                <Label className="text-[10px] text-muted-foreground">السبب</Label>
                <Input value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="مثال: شراء جديد، جرد، تالف…" className="h-9 mt-1 text-sm" />
              </div>
              <Button onClick={handleAdjust} disabled={adjusting} variant="outline" className="h-9 gap-1.5 text-xs">
                {adjusting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : adjMovement === 'add' ? <PackagePlus className="h-3.5 w-3.5" /> : <PackageMinus className="h-3.5 w-3.5" />}
                تنفيذ
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">كل حركة مخزون تُسجَّل — لا يوجد تغيير صامت للمخزون.</p>

            {movements.length > 0 && (
              <div className="rounded-xl border border-border">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 rounded-t-xl">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">حركات المخزون</span>
                </div>
                <div className="divide-y divide-border/40 max-h-56 overflow-y-auto">
                  {movements.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("font-mono font-semibold w-10 text-center", m.quantity > 0 ? 'text-emerald-600' : 'text-destructive')}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </span>
                        <span className="text-muted-foreground truncate">{m.notes || '—'}</span>
                      </div>
                      <span className="text-muted-foreground shrink-0">{formatDateTime(m.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
