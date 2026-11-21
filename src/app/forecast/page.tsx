"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { PageHeader, SegmentedControl } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatCurrency } from '@/lib/utils'
import { AlertTriangle, CalendarRange, Info, TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * /forecast — demand forecast with its measured error.
 *
 * The page publishes the method and the backtest error next to the forecast,
 * because a prediction without an error bar is a wish.
 */

interface ForecastPoint {
  date: string
  orders: number
  revenue: number
  lower: number
  upper: number
}

interface ProductForecast {
  productId: string
  name: string
  unitsPerDay: number
  expectedUnits: number
  depletionDate: string | null
  reorderDate: string | null
  note: string
}

interface Payload {
  window: { label: string }
  historyDays: number
  result: {
    method: string
    methodLabel: string
    horizonDays: number
    points: ForecastPoint[]
    backtestMape: number | null
    backtestDays: number
    confidence: 'low' | 'medium' | 'high'
    assumptions: string[]
    limitations: string[]
    products?: ProductForecast[]
  }
}

const HORIZONS = [7, 14, 30, 60, 90]

export default function ForecastPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [horizon, setHorizon] = useState(14)

  const load = useCallback(async (h: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/intelligence/forecast?horizon=${h}`)
      if (!res.ok) throw new Error('تعذّر بناء التنبؤ')
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(horizon)
  }, [load, horizon])

  const result = data?.result

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <PageHeader
          icon={TrendingUp}
          title="تنبؤ الطلبات"
          description={
            <>
              خط أساس إحصائي مبني على {data?.historyDays ?? 0} يومًا حقيقيًا، مع قياس خطأه على
              أيام محفوظة. ليس تنبؤًا بالذكاء الاصطناعي — بل خط أساس صريح يمكن الوثوق بحدوده.
            </>
          }
          actions={
            <SegmentedControl
              options={HORIZONS.map(h => ({ value: String(h), label: `${h} يوم` }))}
              value={String(horizon)}
              onChange={(value) => setHorizon(Number(value))}
              ariaLabel="أفق التنبؤ"
            />
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : result?.method === 'insufficient_data' ? (
          <Card>
            <CardContent className="p-10 text-center">
              <CalendarRange className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">بيانات غير كافية للتنبؤ</p>
              <p className="text-xs text-muted-foreground">
                {result.limitations.join(' · ')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    الطريقة
                  </span>
                  <p className="mt-1 text-sm font-semibold">{result?.methodLabel}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    خط أساس إحصائي — ليس نموذج تعلّم آلي
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    خطأ التنبؤ المقاس
                  </span>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {result?.backtestMape !== null ? `${result?.backtestMape}%` : '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    MAPE على {result?.backtestDays} أيام محفوظة
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    الثقة
                  </span>
                  <p className="mt-1 text-sm font-semibold">
                    {result?.confidence === 'high'
                      ? 'عالية'
                      : result?.confidence === 'medium'
                        ? 'متوسطة'
                        : 'منخفضة'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    طلبات متوقعة
                  </span>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {Math.round(
                      (result?.points ?? []).reduce((s, p) => s + p.orders, 0),
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    خلال {horizon} يوم
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  الطلبات المتوقعة (مع نطاق 80%)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={result?.points ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fcUpper" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 12,
                        fontSize: 12,
                        direction: 'rtl',
                      }}
                    />
                    <Area dataKey="upper" stroke="none" fill="url(#fcUpper)" name="الحد الأعلى" />
                    <Area
                      type="monotone"
                      dataKey="orders"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="none"
                      name="الطلبات"
                    />
                  </AreaChart>
                </ResponsiveContainer>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold">الافتراضات</p>
                    <ul className="mt-1 space-y-1">
                      {(result?.assumptions ?? []).map(a => (
                        <li key={a} className="text-[11px] text-muted-foreground">
                          • {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold">حدود التنبؤ</p>
                    <ul className="mt-1 space-y-1">
                      {(result?.limitations ?? []).map(l => (
                        <li key={l} className="text-[11px] text-muted-foreground">
                          • {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {result?.products && result.products.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">توقع على مستوى المنتج</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/40 text-right text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 font-medium">المنتج</th>
                          <th className="px-4 py-3 font-medium">وحدات/يوم</th>
                          <th className="px-4 py-3 font-medium">متوقع {horizon} يوم</th>
                          <th className="px-4 py-3 font-medium">تاريخ النفاد</th>
                          <th className="px-4 py-3 font-medium">تاريخ الطلب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.products.slice(0, 12).map(p => (
                          <tr key={p.productId} className="border-b last:border-0">
                            <td className="px-4 py-2.5 font-medium">{p.name}</td>
                            <td className="px-4 py-2.5 tabular-nums">{p.unitsPerDay}</td>
                            <td className="px-4 py-2.5 tabular-nums">{p.expectedUnits}</td>
                            <td className="px-4 py-2.5 tabular-nums">{p.depletionDate ?? '—'}</td>
                            <td className="px-4 py-2.5 tabular-nums">{p.reorderDate ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="flex items-start gap-1.5 border-t p-3 text-[11px] text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      لا يتم إنشاء أي أمر شراء تلقائيًا. نفاد المخزون يُحسب فقط عندما يكون المخزون
                      مُدارًا فعليًا في النظام.
                    </span>
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
