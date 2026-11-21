"use client"

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { BarChart3, Info } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BusinessOverview } from '@/lib/metrics/types'
import { formatCurrency } from '@/lib/utils'

/**
 * The revenue trend — drawn from the metric engine's own daily series.
 *
 * WHY NOT THE OLD CHART
 *
 * The old dashboard chart read `/api/dashboard/sales-chart`, a separate
 * endpoint with its own date handling. Two charts of "the same" period could
 * therefore disagree. This one reads the SAME series the metric cards and
 * the reports use, so the chart cannot tell a different story than the
 * numbers above it.
 *
 * The profit line appears ONLY when the profit is actually known for those
 * days. While the product costs are missing, the chart shows revenue and
 * orders — and says why the profit is not drawn, instead of drawing a line
 * that equals "sales minus zero".
 */
export function RevenueTrend({ dateRange }: { dateRange?: string }) {
  const [overview, setOverview] = useState<BusinessOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = dateRange ? `?dateRange=${encodeURIComponent(dateRange)}` : ''
      const res = await fetch(`/api/metrics/overview${query}`)
      if (!res.ok) return
      setOverview((await res.json()) as BusinessOverview)
    } catch {
      // A chart that cannot load shows its empty state.
    } finally {
      setLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    load()
  }, [load])

  const series = overview?.series ?? []
  const hasKnownProfit = series.some(point => point.profit !== null)

  return (
    <Card className="lg:col-span-3 border-border">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-semibold tracking-tight text-foreground">
            المبيعات اليومية
          </CardTitle>
          {overview?.window?.label && (
            <span className="text-[11px] text-muted-foreground">{overview.window.label}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : series.length === 0 ? (
          <div className="empty-state h-56">
            <BarChart3 className="h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">لا توجد مبيعات في هذه الفترة</p>
            <p className="mt-1 text-xs text-muted-foreground">
              ستظهر بيانات الرسم البياني تلقائياً مع أول طلب
            </p>
          </div>
        ) : (
          <>
            <div className="h-56 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series}>
                  <CartesianGrid vertical={false} stroke="var(--color-border-soft)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={value => String(value).slice(5)}
                    tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    yAxisId="money"
                  />
                  <YAxis hide yAxisId="orders" orientation="right" />
                  <Tooltip
                    formatter={(value, name) => [
                      name === 'revenue'
                        ? formatCurrency(Number(value ?? 0))
                        : Number(value ?? 0),
                      name === 'revenue' ? 'المبيعات' : name === 'orders' ? 'الطلبات' : 'الربح',
                    ]}
                    labelFormatter={label => String(label)}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-popover)',
                      fontSize: 12,
                      direction: 'rtl',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar
                    yAxisId="money"
                    dataKey="revenue"
                    name="revenue"
                    fill="var(--color-chart-1)"
                    radius={[3, 3, 0, 0]}
                    opacity={0.55}
                  />
                  <Line
                    yAxisId="orders"
                    type="monotone"
                    dataKey="orders"
                    name="orders"
                    stroke="var(--color-chart-2)"
                    strokeWidth={1.25}
                    dot={false}
                  />
                  {hasKnownProfit && (
                    <Line
                      yAxisId="money"
                      type="monotone"
                      dataKey="profit"
                      name="profit"
                      stroke="var(--color-success)"
                      strokeWidth={2}
                      dot={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {!hasKnownProfit && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  خط الربح غير معروض لأن تكلفة المنتجات غير مسجّلة — الرسم يعرض المبيعات
                  والطلبات فقط، ولا يعرض خطاً يساوي المبيعات.
                </span>
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
