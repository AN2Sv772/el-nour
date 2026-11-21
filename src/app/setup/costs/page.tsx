"use client"

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatCurrency } from '@/lib/utils'
import { computeCostCoverage, type CostProduct } from '@/lib/setup/cost-coverage'
import { AlertTriangle, CheckCircle2, Loader2, Save, Sparkles , DollarSign } from 'lucide-react'

/**
 * /setup/costs — the missing-data workflow.
 *
 * The dashboard withholds the profit because the product costs are unknown.
 * This page is the shortest honest path from "profit hidden" to "profit
 * computable": type the real purchase cost per product, see the margin
 * appear immediately, save in one click. Nothing here invents a number —
 * the margin stays blank until a real cost is entered.
 */

interface ProductRow {
  id: string
  name: string
  name_ar?: string | null
  sku?: string | null
  price: number
  cost_price: number | null
}

interface MetricsProduct {
  productId: string
  units: number
  revenue: number
}

export default function SetupCostsPage() {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [metrics, setMetrics] = useState<MetricsProduct[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pRes, mRes] = await Promise.all([
        fetch('/api/products?pageSize=200&includeInactive=true'),
        fetch('/api/metrics/products?dateRange=last_30_days'),
      ])
      if (!pRes.ok) throw new Error('تعذّر تحميل المنتجات')
      const pJson = await pRes.json()
      const list: ProductRow[] = pJson?.data?.products ?? pJson?.data ?? []
      setProducts(Array.isArray(list) ? list : [])

      if (mRes.ok) {
        const mJson = await mRes.json()
        const mList: MetricsProduct[] = mJson?.products ?? mJson?.data?.products ?? []
        setMetrics(mList)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const merged: CostProduct[] = useMemo(() => {
    const byId = new Map(metrics.map((m) => [m.productId, m]))
    return products.map((p) => {
      const m = byId.get(p.id)
      const knownCost = typeof p.cost_price === 'number' && p.cost_price > 0 ? p.cost_price : null
      return {
        id: p.id,
        name: p.name_ar || p.name,
        price: Number(p.price ?? 0),
        costPrice: knownCost,
        units: m?.units ?? 0,
        revenue: m?.revenue ?? 0,
      }
    })
  }, [products, metrics])

  const coverage = useMemo(() => computeCostCoverage(merged), [merged])

  /** The value shown in the input: the draft, else the stored cost. */
  const inputValue = useCallback(
    (row: CostProduct) => {
      if (row.id in drafts) return drafts[row.id]
      return row.costPrice !== null ? String(row.costPrice) : ''
    },
    [drafts],
  )

  const setDraft = (id: string, value: string) => {
    setSaved(false)
    setDrafts((d) => ({ ...d, [id]: value }))
  }

  const changed = useMemo(() => {
    const out: { id: string; cost: number }[] = []
    for (const row of merged) {
      if (!(row.id in drafts)) continue
      const raw = drafts[row.id].trim()
      if (raw === '') {
        if (row.costPrice !== null) out.push({ id: row.id, cost: 0 })
        continue
      }
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) continue
      if (row.costPrice === null || Math.abs(value - row.costPrice) > 1e-9) {
        out.push({ id: row.id, cost: value })
      }
    }
    return out
  }, [drafts, merged])

  const save = async () => {
    if (changed.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const results = await Promise.all(
        changed.map(async (c) => {
          const res = await fetch(`/api/products/${c.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cost_price: c.cost }),
          })
          return { id: c.id, ok: res.ok }
        }),
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        throw new Error(`تعذّر حفظ ${failed.length} منتج — راجع الصلاحيات`)
      }
      setDrafts({})
      setSaved(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const missingNow = coverage.missingCost

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          icon={DollarSign}
          title="إدخال تكلفة المنتجات"
          description="لوحة التحكم تحجب صافي الربح لأن تكلفة شراء المنتجات غير مسجّلة. أدخل التكلفة الحقيقية مرة واحدة، وستفتح قائمة الدخل والتدفق النقدي واقتصاديات المنتجات تلقائياً — بدون أي رقم تقديري."
          actions={
          <Button onClick={save} disabled={saving || changed.length === 0} loading={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ {changed.length > 0 ? `(${changed.length})` : ''}
          </Button>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            تم حفظ التكاليف. أعد تحميل التحليلات لتظهر الأرقام الجديدة.
          </div>
        )}

        {/* Progress: what is still blocking the profit statement */}
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {missingNow === 0
                    ? 'كل المنتجات لها تكلفة — صافي الربح قابل للحساب الآن'
                    : `${missingNow} منتج ما زال بلا تكلفة`}
                </span>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {coverage.withCost} / {coverage.totalProducts} منتج ·{' '}
                {Math.round(coverage.ratio * 100)}% من المنتجات
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(coverage.ratio * 100)}%` }}
              />
            </div>
            {coverage.blindRevenue > 0 && (
              <p className="text-xs text-muted-foreground">
                مبيعات products بلا تكلفة مسجّلة: {formatCurrency(coverage.blindRevenue)} — هذا المبلغ
                هو ما يحجب مجمل الربح.
              </p>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">المنتجات</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-right text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">المنتج</th>
                      <th className="px-4 py-3 font-medium">مبيعات 30 يوم</th>
                      <th className="px-4 py-3 font-medium">سعر البيع</th>
                      <th className="px-4 py-3 font-medium">تكلفة الشراء</th>
                      <th className="px-4 py-3 font-medium">الهامش</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.rows.map((row) => {
                      const draftValue = inputValue(row)
                      const previewCost = draftValue.trim() === '' ? null : Number(draftValue)
                      const previewMargin =
                        previewCost !== null && Number.isFinite(previewCost) && row.price > 0
                          ? row.price - previewCost
                          : null
                      const previewPct =
                        previewMargin !== null ? (previewMargin / row.price) * 100 : null
                      const dirty = changed.some((c) => c.id === row.id)
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            'border-b last:border-0',
                            !row.hasCost && 'bg-amber-500/[0.04]',
                          )}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.name}</div>
                            {row.units > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {row.units} وحدة مباعة
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {row.revenue > 0 ? formatCurrency(row.revenue) : '—'}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{formatCurrency(row.price)}</td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={draftValue}
                              placeholder="غير مسجّلة"
                              onChange={(e) => setDraft(row.id, e.target.value)}
                              className={cn(
                                'h-9 w-40 text-left tabular-nums',
                                dirty && 'border-primary ring-2 ring-primary/20',
                              )}
                            />
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {previewMargin === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span
                                className={cn(
                                  'font-medium',
                                  previewMargin < 0 ? 'text-destructive' : 'text-emerald-600',
                                )}
                              >
                                {formatCurrency(previewMargin)}
                                {previewPct !== null && (
                                  <span className="mr-1 text-xs text-muted-foreground">
                                    ({previewPct.toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {coverage.rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                          لا توجد منتجات في الكتالوج.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground">
            بعد حفظ التكاليف تبقى خطوة واحدة لفتح الربح الكامل: تسجيل <strong>المصروفات</strong>{' '}
            (شحن/تغليف/إعلانات) و<strong>دفعات التحصيل</strong>. يمكن تسجيلها من صفحة{' '}
            <a href="/reports" className="text-primary underline">
              التقارير
            </a>{' '}
            أو من مساعد الوكلاء الذي يحوّل كل إدخال إلى <strong>طلب موافقة</strong> قبل التنفيذ.
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
