"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { formatCurrency, formatDate } from "@/lib/utils"
import { StatusChip } from "@/components/business/metric-card"
import { cn } from "@/lib/utils"
import {
  TrendingUp, TrendingDown, Wallet, Loader2, Plus, Trash2,
  Receipt, BarChart3, AlertCircle, CheckCircle,
} from "lucide-react"

type Status = 'actual' | 'estimated' | 'incomplete' | 'unavailable' | 'not_applicable'

interface StatementLine {
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

interface FinancialData {
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
  statement: {
    lines: StatementLine[]
    provisionalProfit: number | null
    finalProfit: number | null
    status: Status
    missing: string[]
    summary: string
  }
  daily: { date: string; orders: number; revenue: number; cost: number; expenses: number; profit: number | null }[]
  productEconomics: {
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
    blindRevenue: number | null
    blindProductCount: number
    summary: string
  }
  cashFlow: {
    status: Status
    totals: { expected: number | null; received: number | null; outstanding: number | null; deductions: number }
    cashBackedRatio: number | null
    summary: string
  }
  expensesByCategory: { category: string; amount: number; count: number }[]
  expensesNotRecorded: boolean
}

interface ExpenseRow {
  id: string
  category: string
  amount: number
  expense_date: string
  notes: string | null
  voided_at: string | null
}

const CAT_LABELS: Record<string, string> = {
  shipping: 'شحن',
  packaging: 'تغليف',
  advertising: 'إعلانات',
  other: 'أخرى',
}

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = today.slice(0, 8) + '01'

  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<FinancialData | null>(null)
  const [error, setError] = useState('')

  // Expenses
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [newExpense, setNewExpense] = useState({ category: 'shipping', amount: '', expense_date: today, notes: '' })
  const [addingExpense, setAddingExpense] = useState(false)
  const [expenseMsg, setExpenseMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/reports/financial?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      if (res.ok) setData(await res.json())
      else { const d = await res.json().catch(() => ({})); setError(d.error || 'فشل التحميل') }

      const expRes = await fetch(`/api/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      if (expRes.ok) { const d = await expRes.json(); setExpenses(d.data || []) }
    } catch {
      setError('تعذر الوصول للخادم')
    }
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const addExpense = async () => {
    if (addingExpense) return
    if (!newExpense.amount || Number(newExpense.amount) <= 0) {
      setExpenseMsg({ ok: false, text: 'أدخل مبلغًا صحيحًا' }); return
    }
    setAddingExpense(true); setExpenseMsg(null)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newExpense, amount: Number(newExpense.amount) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) {
        setExpenseMsg({ ok: false, text: d.error || 'فشل الإضافة' })
      } else {
        setExpenseMsg({ ok: true, text: 'تمت الإضافة ✓' })
        setNewExpense(p => ({ ...p, amount: '', notes: '' }))
        await load()
      }
    } catch {
      setExpenseMsg({ ok: false, text: 'تعذر الوصول للخادم' })
    }
    setAddingExpense(false)
  }

  const voidExpense = async (id: string) => {
    const expense = expenses.find((e) => e.id === id)
    const label = expense
      ? `${CAT_LABELS[expense.category] || expense.category} — ${formatCurrency(expense.amount)}`
      : 'هذا المصروف'
    if (!confirm(`حذف المصروف (${label})؟ لن يظهر في التقارير بعد الآن.`)) return

    setExpenseMsg(null)
    try {
      const res = await fetch(`/api/expenses?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setExpenseMsg({ ok: false, text: d.error || 'تعذّر حذف المصروف' })
        return
      }
      setExpenseMsg({ ok: true, text: 'تم حذف المصروف' })
      await load()
    } catch {
      setExpenseMsg({ ok: false, text: 'تعذّر الوصول للخادم' })
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header + range */}
        <PageHeader
          icon={BarChart3}
          title="التقارير المالية"
          description="أرباح فعلية محسوبة من بيانات حقيقية — ربح أولي مقابل ربح بعد التسوية."
          actions={
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground" htmlFor="reports-date-from">من</Label>
                <Input id="reports-date-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground" htmlFor="reports-date-to">إلى</Label>
                <Input id="reports-date-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
              </div>
            </div>
          }
        />

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        ) : data ? (
          <>
            {/* ─── The statement (honest) ─── */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">المبيعات المحتسبة</p>
                    <TrendingUp className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(data.statement.lines.find(l => l.key === 'revenue')?.value ?? 0)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">من سجلات الطلبات — رقم فعلي</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-primary/20 bg-primary/5">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-primary">صافي الربح المبدئي</p>
                    <CheckCircle className="h-4 w-4 text-primary/60" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {data.statement.provisionalProfit === null
                      ? '—'
                      : formatCurrency(data.statement.provisionalProfit)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {data.statement.provisionalProfit === null
                      ? 'محجوب — مدخلاته ناقصة'
                      : 'قبل خصم المرتجعات'}
                  </p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">صافي الربح النهائي</p>
                    <TrendingDown className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {data.statement.finalProfit === null ? '—' : formatCurrency(data.statement.finalProfit)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {data.statement.finalProfit === null
                      ? 'محجوب — خسارة المرتجعات غير معروفة'
                      : 'بعد خصم المرتجعات'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ─── The statement lines ─── */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">
                    قائمة الدخل — {data.window.label}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <StatusChip status={data.statement.status} />
                    <a
                      href={`/api/reports/financial?from=${dateFrom}&to=${dateTo}&format=csv&export=daily`}
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      تصدير CSV
                    </a>
                  </div>
                </div>
                <CardDescription className="text-xs">
                  كل بند محسوب بنفس المحرك المستخدم في لوحة التحكم — والبند الذي لا يمكن احتسابه
                  يُعرض بحالته بدل رقم.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {data.statement.lines.map(line => (
                  <div
                    key={line.key}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2',
                      line.kind === 'result' && 'border border-border bg-muted/40',
                      line.kind === 'subtotal' && 'bg-muted/20'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('text-[13px]', line.kind === 'result' ? 'font-semibold' : 'font-medium')}>
                        {line.deduction && <span className="text-muted-foreground">− </span>}
                        {line.label}
                      </span>
                      <StatusChip status={line.status} />
                    </div>
                    <span className={cn('text-[14px] font-semibold tabular-nums', line.value === null && 'text-muted-foreground/50')}>
                      {line.value === null ? '—' : formatCurrency(line.value)}
                    </span>
                    {line.missing.length > 0 && (
                      <p className="w-full text-[11px] leading-relaxed text-warning">{line.missing[0]}</p>
                    )}
                  </div>
                ))}
                <p className="pt-2 text-[12px] leading-relaxed text-muted-foreground">
                  {data.statement.summary}
                </p>
              </CardContent>
            </Card>

            {/* ─── Expenses management ─── */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                  المصروفات
                </CardTitle>
                <CardDescription className="text-xs">تُخصم من الربح في يومها — حذف المصروف يحفظ سجل التدقيق (إلغاء)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <div className="grid gap-2 sm:grid-cols-5">
                  <select
                    value={newExpense.category}
                    onChange={e => setNewExpense(p => ({ ...p, category: e.target.value }))}
                    className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
                    aria-label="التصنيف"
                  >
                    {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <Input id="reports-expense-amount" type="number" min="0" step="0.01" placeholder="المبلغ" value={newExpense.amount}
                    aria-label="مبلغ المصروف"
                    onChange={e => setNewExpense(p => ({ ...p, amount: e.target.value }))} className="h-9 text-sm" />
                  <Input id="reports-expense-date" type="date" value={newExpense.expense_date}
                    aria-label="تاريخ المصروف"
                    onChange={e => setNewExpense(p => ({ ...p, expense_date: e.target.value }))} className="h-9 text-sm" />
                  <Input id="reports-expense-notes" placeholder="ملاحظة (اختياري)" value={newExpense.notes}
                    aria-label="ملاحظة المصروف (اختياري)"
                    onChange={e => setNewExpense(p => ({ ...p, notes: e.target.value }))} className="h-9 text-sm" />
                  <Button onClick={addExpense} disabled={addingExpense} className="h-9 gap-1.5 text-xs">
                    {addingExpense ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    إضافة
                  </Button>
                </div>
                {expenseMsg && (
                  <p
                    role={expenseMsg.ok ? 'status' : 'alert'}
                    aria-atomic="true"
                    className={cn("text-xs flex items-center gap-1", expenseMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}
                  >
                    {expenseMsg.ok ? <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />} {expenseMsg.text}
                  </p>
                )}

                {data.expensesNotRecorded ? (
                  <div className="rounded-xl border border-warning/30 bg-warning-muted/30 p-3 text-[12px] leading-relaxed text-muted-foreground">
                    لا توجد مصروفات مسجّلة في النظام — الرقم صفر لأن التسجيل غير منظم، لا لأن الإنفاق صفر.
                    أضف أول مصروف من النموذج أعلاه ليصبح الربح المحسوب واقعياً.
                  </div>
                ) : data.expensesByCategory.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">لا توجد مصروفات في هذه الفترة.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {data.expensesByCategory.map(category => (
                      <div key={category.category} className="rounded-xl border bg-muted/30 p-3">
                        <p className="text-[11px] text-muted-foreground">
                          {CAT_LABELS[category.category] || category.category}
                        </p>
                        <p className="text-lg font-bold">{formatCurrency(category.amount)}</p>
                      </div>
                    ))}
                  </div>
                )}

                {expenses.length > 0 && (
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-xs text-muted-foreground">
                          <th className="text-right font-medium px-3 py-2">التاريخ</th>
                          <th className="text-right font-medium px-3 py-2">التصنيف</th>
                          <th className="text-right font-medium px-3 py-2">ملاحظة</th>
                          <th className="text-left font-medium px-3 py-2">المبلغ</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map(e => (
                          <tr key={e.id} className={cn("border-t border-border/40", e.voided_at && "opacity-40")}>
                            <td className="px-3 py-2">{formatDate(e.expense_date)}</td>
                            <td className="px-3 py-2">{CAT_LABELS[e.category] || e.category}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[200px]">{e.notes || '—'}</td>
                            <td className="px-3 py-2 text-left font-semibold tabular-nums">{formatCurrency(e.amount)}</td>
                            <td className="px-3 py-2">
                              {!e.voided_at && (
                                <button
                                  onClick={() => voidExpense(e.id)}
                                  className="text-destructive hover:text-destructive/80 p-1.5 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label="حذف المصروف"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Daily breakdown ─── */}
            {data.daily.length > 0 && (
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">التفصيل اليومي</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-xs text-muted-foreground">
                          <th className="text-right font-medium px-3 py-2">اليوم</th>
                          <th className="text-center font-medium px-3 py-2">طلبات</th>
                          <th className="text-center font-medium px-3 py-2">مبيعات</th>
                          <th className="text-center font-medium px-3 py-2">تكلفة</th>
                          <th className="text-center font-medium px-3 py-2">مصروفات</th>
                          <th className="text-left font-medium px-3 py-2">ربح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.daily.map(d => (
                          <tr key={d.date} className="border-t border-border/40">
                          <td className="px-3 py-2">{formatDate(d.date)}</td>
                          <td className="px-3 py-2 text-center">{d.orders}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{formatCurrency(d.revenue)}</td>
                          <td className="px-3 py-2 text-center tabular-nums">
                            {d.profit === null ? '—' : formatCurrency(d.cost)}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums">
                            {d.profit === null ? '—' : formatCurrency(d.expenses)}
                          </td>
                          <td className={cn('px-3 py-2 text-left font-semibold tabular-nums', d.profit !== null && d.profit < 0 ? 'text-destructive' : '')}>
                            {d.profit === null ? '—' : formatCurrency(d.profit)}
                          </td>
                        </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ─── Product economics ─── */}
            {data.productEconomics.products.length > 0 && (
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">ربحية المنتجات</CardTitle>
                    <a
                      href={`/api/reports/financial?from=${dateFrom}&to=${dateTo}&format=csv&export=products`}
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      تصدير CSV
                    </a>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
                    {data.productEconomics.summary}
                  </p>
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-xs text-muted-foreground">
                          <th className="text-right font-medium px-3 py-2">المنتج</th>
                          <th className="text-center font-medium px-3 py-2">كمية مباعة</th>
                          <th className="text-center font-medium px-3 py-2">إيراد</th>
                          <th className="text-center font-medium px-3 py-2">تكلفة</th>
                          <th className="text-left font-medium px-3 py-2">هامش</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.productEconomics.products.slice(0, 20).map(p => (
                          <tr key={p.productId} className="border-t border-border/40">
                            <td className="px-3 py-2 truncate max-w-[240px]">{p.name}</td>
                            <td className="px-3 py-2 text-center tabular-nums">{p.units}</td>
                            <td className="px-3 py-2 text-center tabular-nums">{formatCurrency(p.revenue)}</td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {p.margin === null ? '—' : formatCurrency(p.cost)}
                            </td>
                            <td className={cn('px-3 py-2 text-left font-semibold tabular-nums',
                              p.margin === null
                                ? 'text-muted-foreground'
                                : p.margin < 0
                                  ? 'text-destructive'
                                  : 'text-emerald-600')}>
                              {p.margin === null ? '—' : formatCurrency(p.margin)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}
