"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader, SegmentedControl } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusChip } from '@/components/business/metric-card'
import { cn, formatCurrency } from '@/lib/utils'
import {
  AlertTriangle,
  Calculator,
  Banknote,
  Boxes,
  FileBarChart,
  Info,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/* ------------------------------------------------------------------ */
/* Types (mirror the API payload)                                      */
/* ------------------------------------------------------------------ */

type Status = 'actual' | 'estimated' | 'incomplete' | 'unavailable' | 'not_applicable'

interface PnlLine {
  key: string
  label: string
  value: number | null
  kind: 'revenue' | 'cost' | 'subtotal' | 'result'
  status: Status
  calculation: string
  source: string[]
  missing: string[]
  deduction?: boolean
}

interface ProfitAndLoss {
  lines: PnlLine[]
  provisionalProfit: number | null
  finalProfit: number | null
  status: Status
  missing: string[]
  summary: string
}

interface CashBatch {
  id: string
  createdAt: string | null
  expected: number | null
  received: number | null
  deductions: number
  difference: number | null
  status: string | null
}

interface CashFlow {
  status: Status
  batches: CashBatch[]
  totals: { expected: number | null; received: number | null; outstanding: number | null; deductions: number }
  cashBackedRatio: number | null
  missing: string[]
  summary: string
}

interface ProductEconomics {
  status: Status
  products: {
    productId: string
    name: string
    sku: string | null
    units: number
    revenue: number
    cost: number
    margin: number | null
    marginPercent: number | null
    status: Status
    revenueShare: number | null
  }[]
  totals: { revenue: number; cost: number; units: number }
  concentration: { top1Share: number | null; top3Share: number | null }
  blindRevenue: number | null
  blindProductCount: number
  blindProducts: { productId: string; name: string; sku: string | null; units: number; revenue: number }[]
  missing: string[]
  summary: string
}

interface AnalyticsPayload {
  window: {
    preset: string
    label: string
    from: string | null
    to: string | null
    previousFrom: string | null
    previousTo: string | null
    timezone: string
    computedAt: string
  }
  profitAndLoss: ProfitAndLoss
  cashFlow: CashFlow
  productEconomics: ProductEconomics
  expensesByCategory: { category: string; amount: number; count: number }[]
  expensesNotRecorded: boolean
  previous: { from: string | null; to: string | null; revenue: number | null }
}

const CATEGORY_LABEL: Record<string, string> = {
  shipping: 'شحن',
  packaging: 'تغليف',
  advertising: 'إعلانات',
  other: 'أخرى',
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (preset: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/analytics?dateRange=${preset}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? 'تعذّر تحميل التحليلات')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }, [])

  const [preset, setPreset] = useState('last_30_days')

  useEffect(() => {
    load(preset)
  }, [load, preset])

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <PageHeader
          icon={FileBarChart}
          title="التحليلات المالية"
          description="قائمة دخل وتدفق نقدي واقتصاديات منتجات — كل بند يحمل مصدره وحالته. البنود التي لا يمكن احتسابها بدقّة تُعرض بحالةها بدل رقم مضلّل."
          actions={
            <SegmentedControl
              options={[
                { value: 'last_7_days', label: '٧ أيام' },
                { value: 'last_30_days', label: '٣٠ يوم' },
                { value: 'this_month', label: 'هذا الشهر' },
                { value: 'all', label: 'الكل' },
              ]}
              value={preset}
              onChange={(value) => setPreset(value)}
              ariaLabel="الفترة"
            />
          }
        />

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-[13px] text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-80 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            {/* ── Window ──────────────────────────────────────────────── */}
            <p className="text-[12px] text-muted-foreground">
              الفترة: <span className="font-medium text-foreground">{data.window.label}</span>
              {data.window.from && data.window.to && (
                <span className="mx-1.5 text-muted-foreground/60">·</span>
              )}
              {data.window.from && (
                <span dir="ltr" className="font-mono text-[11px]">
                  {data.window.from.slice(0, 10)} → {data.window.to?.slice(0, 10)}
                </span>
              )}
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              {data.window.timezone}
            </p>

            <Tabs defaultValue="pnl" className="space-y-4">
              <TabsList>
                <TabsTrigger value="pnl">قائمة الدخل</TabsTrigger>
                <TabsTrigger value="cash">التدفق النقدي</TabsTrigger>
                <TabsTrigger value="products">اقتصاديات المنتجات</TabsTrigger>
              </TabsList>

              {/* ── Profit & loss ────────────────────────────────────── */}
              <TabsContent value="pnl" className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">قائمة الدخل</CardTitle>
                      <StatusChip status={data.profitAndLoss.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {data.profitAndLoss.lines.map(line => (
                      <PnlRow key={line.key} line={line} />
                    ))}

                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        {data.profitAndLoss.summary}
                      </p>
                    </div>

                    {data.profitAndLoss.missing.length > 0 && (
                      <ul className="space-y-1 pt-1">
                        {data.profitAndLoss.missing.map(item => (
                          <li key={item} className="flex items-start gap-1.5 text-[11px] text-warning">
                            <span aria-hidden="true">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* The missing data has a door: enter the real product
                        costs and the profit statement opens itself. */}
                    {data.profitAndLoss.status !== 'actual' && (
                      <Button asChild variant="outline" size="sm" className="mt-3">
                        <Link href="/setup/costs">
                          <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                          إدخال تكلفة المنتجات الآن
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Expense breakdown */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">المصروفات حسب البند</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.expensesNotRecorded ? (
                      <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning-muted/40 px-3 py-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                        <div>
                          <p className="text-[13px] font-medium">لا تُسجَّل مصروفات في النظام إطلاقاً</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            جدول المصروفات فارغ تماماً. الرقم صفر لأن التسجيل غير منظم — لا لأن
                            الإنفاق صفر. أي ربح يُحسب الآن يتجاهل الإيجار والرواتب والتغليف.
                          </p>
                        </div>
                      </div>
                    ) : data.expensesByCategory.length === 0 ? (
                      <p className="py-4 text-center text-[13px] text-muted-foreground">
                        لا توجد مصروفات في هذه الفترة.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {data.expensesByCategory.map(category => (
                          <div key={category.category} className="flex items-center gap-3">
                            <span className="w-24 shrink-0 text-[12px] text-muted-foreground">
                              {CATEGORY_LABEL[category.category] ?? category.category}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-destructive/70"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (category.amount /
                                      Math.max(
                                        ...data.expensesByCategory.map(c => c.amount),
                                        1
                                      )) *
                                      100
                                  )}%`,
                                }}
                              />
                            </div>
                            <span className="w-24 shrink-0 text-left text-[12px] font-medium tabular-nums">
                              {formatCurrency(category.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Cash flow ────────────────────────────────────────── */}
              <TabsContent value="cash" className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatTile
                    icon={Wallet}
                    label="المحصّل فعلياً"
                    value={data.cashFlow.totals.received}
                    status={data.cashFlow.status}
                  />
                  <StatTile
                    icon={Banknote}
                    label="مستحق لدى شركات الشحن"
                    value={data.cashFlow.totals.outstanding}
                    status={data.cashFlow.status}
                  />
                  <StatTile
                    icon={FileBarChart}
                    label="نسبة التغطية النقدية"
                    value={data.cashFlow.cashBackedRatio}
                    status={data.cashFlow.cashBackedRatio === null ? 'unavailable' : 'actual'}
                    suffix="%"
                  />
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">دفعات التحصيل</CardTitle>
                      <StatusChip status={data.cashFlow.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {data.cashFlow.batches.length === 0 ? (
                      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                        <div>
                          <p className="text-[13px] font-medium">لا توجد دفعات تحصيل مسجّلة</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            {data.cashFlow.summary}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="h-56 w-full" dir="ltr">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.cashFlow.batches}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                              <XAxis
                                dataKey="createdAt"
                                tickFormatter={v => (v ? String(v).slice(5, 10) : '')}
                                tick={{ fontSize: 11 }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                              <Tooltip
                                formatter={(value, name) => [
                                  formatCurrency(Number(value ?? 0)),
                                  name === 'expected' ? 'المتوقع' : 'المستلم',
                                ]}
                                contentStyle={{
                                  borderRadius: 12,
                                  border: '1px solid var(--color-border)',
                                  fontSize: 12,
                                }}
                              />
                              <Bar dataKey="expected" fill="var(--color-muted-foreground)" radius={[6, 6, 0, 0]} />
                              <Bar dataKey="received" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-border text-muted-foreground">
                                <th className="py-2 text-right font-medium">الدفعة</th>
                                <th className="py-2 text-left font-medium">المتوقع</th>
                                <th className="py-2 text-left font-medium">المستلم</th>
                                <th className="py-2 text-left font-medium">الخصومات</th>
                                <th className="py-2 text-left font-medium">الفرق</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.cashFlow.batches.map(batch => (
                                <tr key={batch.id} className="border-b border-border/50">
                                  <td className="py-2 text-right font-mono text-[11px]">
                                    {batch.createdAt ? batch.createdAt.slice(0, 10) : '—'}
                                  </td>
                                  <td className="py-2 text-left tabular-nums">
                                    {batch.expected === null ? '—' : formatCurrency(batch.expected)}
                                  </td>
                                  <td className="py-2 text-left tabular-nums">
                                    {batch.received === null ? '—' : formatCurrency(batch.received)}
                                  </td>
                                  <td className="py-2 text-left tabular-nums">
                                    {formatCurrency(batch.deductions)}
                                  </td>
                                  <td
                                    className={cn(
                                      'py-2 text-left tabular-nums',
                                      batch.difference !== null && batch.difference < 0
                                        ? 'text-destructive'
                                        : 'text-success'
                                    )}
                                  >
                                    {batch.difference === null ? '—' : formatCurrency(batch.difference)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Product economics ────────────────────────────────── */}
              <TabsContent value="products" className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">ربحية المنتجات</CardTitle>
                      <StatusChip status={data.productEconomics.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      {data.productEconomics.summary}
                    </p>

                    {data.productEconomics.products.length === 0 ? (
                      <p className="py-6 text-center text-[13px] text-muted-foreground">
                        لا توجد مبيعات في هذه الفترة.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="py-2 text-right font-medium">المنتج</th>
                              <th className="py-2 text-left font-medium">الوحدات</th>
                              <th className="py-2 text-left font-medium">المبيعات</th>
                              <th className="py-2 text-left font-medium">النسبة</th>
                              <th className="py-2 text-left font-medium">التكلفة</th>
                              <th className="py-2 text-left font-medium">الهامش</th>
                              <th className="py-2 text-left font-medium">الحالة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.productEconomics.products.map(product => (
                              <tr key={product.productId} className="border-b border-border/50">
                                <td className="py-2 text-right">
                                  <p className="font-medium">{product.name}</p>
                                  {product.sku && (
                                    <p className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                                      {product.sku}
                                    </p>
                                  )}
                                </td>
                                <td className="py-2 text-left tabular-nums">{product.units}</td>
                                <td className="py-2 text-left tabular-nums">{formatCurrency(product.revenue)}</td>
                                <td className="py-2 text-left tabular-nums">
                                  {product.revenueShare === null ? '—' : `${product.revenueShare}%`}
                                </td>
                                <td className="py-2 text-left tabular-nums">
                                  {product.margin === null ? '—' : formatCurrency(product.cost)}
                                </td>
                                <td className="py-2 text-left tabular-nums">
                                  {product.margin === null ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <span className={product.margin < 0 ? 'text-destructive' : 'text-success'}>
                                      {formatCurrency(product.margin)}
                                      {product.marginPercent !== null && (
                                        <span className="text-[10px] text-muted-foreground">
                                          {' '}
                                          ({product.marginPercent}%)
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 text-left">
                                  <StatusChip status={product.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Products that sold without a known cost */}
                {data.productEconomics.blindProductCount > 0 && (
                  <Card className="border-warning/25">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <Boxes className="h-4 w-4 text-warning" aria-hidden="true" />
                        <CardTitle className="text-sm font-semibold">
                          منتجات بيعت بدون تكلفة مسجّلة
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {data.productEconomics.blindProducts.map(product => (
                        <div
                          key={product.productId}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                        >
                          <span className="text-[12px] font-medium">{product.name}</span>
                          <span className="text-[12px] tabular-nums text-muted-foreground">
                            {product.units} وحدة · {formatCurrency(product.revenue)}
                          </span>
                        </div>
                      ))}
                      <p className="pt-1 text-[12px] leading-relaxed text-muted-foreground">
                        مبيعات هذه المنتجات بلا تكلفة معروفة، لذلك لا يظهر هامش ربح لها. اطلب من
                        المساعد تسجيل التكلفة لتحرير رقم الربح.
                      </p>
                      <Button asChild size="sm" variant="outline">
                        <a href="/agent">سجّل التكلفة عبر المساعد</a>
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

/* ------------------------------------------------------------------ */
/* Small parts                                                         */
/* ------------------------------------------------------------------ */

function PnlRow({ line }: { line: PnlLine }) {
  const isResult = line.kind === 'result'
  const isSubtotal = line.kind === 'subtotal'
  const hasValue = line.value !== null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5',
        isResult && 'border border-border bg-muted/50',
        isSubtotal && 'bg-muted/25'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'text-[13px]',
            isResult ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'
          )}
        >
          {line.deduction && <span className="text-muted-foreground">− </span>}
          {line.label}
        </span>
        <StatusChip status={line.status} />
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'text-[14px] font-semibold tabular-nums',
            hasValue ? 'text-foreground' : 'text-muted-foreground/50'
          )}
        >
          {hasValue ? formatCurrency(line.value as number) : '—'}
        </span>
      </div>
      {line.missing.length > 0 && (
        <p className="w-full text-[11px] leading-relaxed text-warning">{line.missing[0]}</p>
      )}
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  status,
  suffix,
}: {
  icon: React.ElementType
  label: string
  value: number | null
  status: Status
  suffix?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground/40" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className="mt-2 text-[22px] font-bold leading-none tabular-nums">
        {value === null ? '—' : suffix ? `${value}${suffix}` : formatCurrency(value)}
      </p>
      <div className="mt-2">
        <StatusChip status={status} />
      </div>
    </div>
  )
}
