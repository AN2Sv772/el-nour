"use client"

import * as React from "react"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { ExecutiveOverview } from "@/components/business/executive-overview"
import { RevenueTrend } from "@/components/business/revenue-trend"
import { DecisionsStrip } from "@/components/business/decisions-strip"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Package,
  DollarSign,
  Clock,
  AlertTriangle,
  Truck,
  LayoutDashboard,
} from "lucide-react"
import { formatCurrency, formatNumber, cn, statusColors } from "@/lib/utils"
import { PageHeader, SegmentedControl, MetricBlock } from "@/components/shell/page-header"
import { DATE_RANGE_PRESETS } from "@/lib/date-range"
import type { DashboardStats } from "@/types"
import type { BusinessOverview } from "@/lib/metrics/types"

// ─── Types ───────────────────────────────────────────────────────────────────

interface TopProduct {
  id: string
  name: string
  name_ar: string | null
  sku: string
  sales: number
  revenue: number
}

interface DeliveryPerformance {
  on_time_rate: number
  avg_delivery_days: number
  late_orders: number
  failed_deliveries: number
  total_delivered: number
  total_shipped: number
}

interface RecentOrder {
  id: string
  customer: string
  total: number
  status: string
  date: string
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [dateRange, setDateRange] = React.useState("last_30_days")
  const [stats, setStats] = React.useState<DashboardStats | null>(null)
  const [topProducts, setTopProducts] = React.useState<TopProduct[]>([])
  const [deliveryPerformance, setDeliveryPerformance] = React.useState<DeliveryPerformance | null>(null)
  const [recentOrders, setRecentOrders] = React.useState<RecentOrder[]>([])
  const [salesChartData, setSalesChartData] = React.useState<{ labels: string[]; datasets: { label: string; data: number[]; backgroundColor?: string; borderColor?: string }[] } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [overview, setOverview] = React.useState<BusinessOverview | null>(null)
  const [widgetsLoading, setWidgetsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // True while the product costs are missing — the legacy profit card says so
  // instead of presenting an over-stated number as fact.
  const profitCostsMissing =
    overview?.byKey?.product_costs?.provenance?.status === 'incomplete' ||
    overview?.byKey?.product_costs?.provenance?.status === 'unavailable'

  React.useEffect(() => {
    const fetchStats = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/dashboard/stats?dateRange=${dateRange}`)
        if (response.ok) {
          const data = await response.json()
          setStats(data)
        } else {
          setError("تعذر تحميل البيانات. حاول مرة أخرى.")
        }

        const chartResponse = await fetch(`/api/dashboard/sales-chart?dateRange=${dateRange}`)
        if (chartResponse.ok) {
          const chartData = await chartResponse.json()
          setSalesChartData(chartData.data)
        }
      } catch {
        setError("تعذر الاتصال بالخادم")
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [dateRange])

  React.useEffect(() => {
    const fetchWidgets = async () => {
      setWidgetsLoading(true)
      try {
        const [productsRes, deliveryRes, ordersRes] = await Promise.all([
          fetch(`/api/dashboard/top-products?limit=5&dateFrom=${dateRange === 'today' ? new Date().toISOString().split('T')[0] : ''}`),
          fetch(`/api/dashboard/delivery-performance`),
          fetch(`/api/orders?page=1&pageSize=5&sortBy=created_at&sortOrder=desc`),
        ])

        if (productsRes.ok) {
          const data = await productsRes.json()
          setTopProducts(data.data || [])
        }
        if (deliveryRes.ok) {
          const data = await deliveryRes.json()
          setDeliveryPerformance(data.data)
        }
        if (ordersRes.ok) {
          const data = await ordersRes.json()
          setRecentOrders((data.data || []).map((order: { order_number: string; customer?: { name?: string }; total_amount: number; status: string; created_at: string }) => ({
            id: order.order_number,
            customer: order.customer?.name || 'غير معروف',
            total: order.total_amount,
            status: order.status,
            date: order.created_at.split('T')[0],
          })))
        }
      } catch {
        // silent
      } finally {
        setWidgetsLoading(false)
      }
    }
    fetchWidgets()
  }, [dateRange])

  // Loading skeleton
  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          {/* The heading must exist in the loading state too, otherwise the
              page has no h1 until the data arrives (F-018). */}
          <h1 className="sr-only">لوحة التحكم</h1>
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-10 w-40 rounded-xl" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        {/* ─── Header — the reference's title block + the window pills ─────── */}
        <PageHeader
          icon={LayoutDashboard}
          title="لوحة التحكم"
          description="حالة البيزنس الآن — كل رقم بمصدره."
          actions={
            /* One control, not two: the reference's header carries a single
               pill group, and a second dropdown repeating the same choice
               only makes the user wonder which one is live. */
            <SegmentedControl
              options={DATE_RANGE_PRESETS.filter(p => p.value !== "custom")
                .map(p => ({ value: p.value, label: p.label }))}
              value={dateRange}
              onChange={(value) => setDateRange(value)}
              ariaLabel="الفترة"
            />
          }
        />

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2.5 rounded-xl bg-destructive/8 border border-destructive/20 p-3.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Executive overview (the truthful layer) ───────────────────── */}
        <ExecutiveOverview dateRange={dateRange} onOverview={setOverview} />

        {/* ─── What needs a decision ─────────────────────────────────────── */}
        <DecisionsStrip />

        {/* ─── Cash & collections — kept out of the KPI strip on purpose: it is
                not revenue, and mixing the two is how a dashboard starts lying. */}
        <div className="card grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          <MetricBlock
            label="النقد المستلم فعليًا (تحصيلات)"
            value={formatCurrency((stats as unknown as Record<string, number>)?.collections_received ?? 0)}
            icon={DollarSign}
            hint="محصّل من شركات الشحن — ليس إيراداً"
          />
          <MetricBlock
            label="رصيد مستحق من شركات الشحن"
            value={formatCurrency((stats as unknown as Record<string, number>)?.collections_outstanding ?? 0)}
            icon={AlertTriangle}
            tone="warn"
            hint="يُحصَّل لاحقاً — لا يُحتسب كربح"
          />
        </div>

        {/* ─── Needs Attention (compact strip — only shown when there's data) ─ */}
        {(stats?.pending_orders ?? 0) > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">يحتاج انتباهك:</span>
            {(stats?.pending_orders ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <Clock className="h-3.5 w-3.5" />
                {stats?.pending_orders} طلب قيد الانتظار
              </span>
            )}
            <Button variant="link" size="sm" className="mr-auto h-auto p-0 py-1 -my-1 text-xs text-amber-700 dark:text-amber-400 underline underline-offset-2">
              عرض الكل
            </Button>
          </div>
        ) : null}

        {/* ─── Chart + Status (2-column) ──────────────────────────────────── */}
        <h2 className="sr-only">الرؤى والتحليلات</h2>
        <div className="grid gap-4 lg:grid-cols-5">
          {/* The revenue trend — the metric engine's own series */}
          <RevenueTrend dateRange={dateRange} />

          {/* Order Status — top 5 only */}
          <Card className="lg:col-span-2 rounded-2xl border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">حالة الطلبات</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {widgetsLoading || !stats ? (
                <div className="space-y-2.5">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-9 rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {[
                    { key: 'pending_orders', label: 'قيد الانتظار', color: 'bg-amber-400' },
                    { key: 'confirmed_orders', label: 'مؤكد', color: 'bg-sky-400' },
                    { key: 'delivered_orders', label: 'تم التسليم', color: 'bg-emerald-400' },
                    { key: 'shipped_orders', label: 'تم الشحن', color: 'bg-cyan-400' },
                    { key: 'cancelled_orders', label: 'ملغي', color: 'bg-red-400' },
                  ].slice(0, 5).map((status) => {
                    const value = (stats as unknown as Record<string, number>)[status.key] ?? 0
                    const total = stats.total_orders || 1
                    const pct = Math.round((value / total) * 100)
                    return (
                      <div key={status.key} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", status.color)} />
                        <span className="text-xs text-muted-foreground flex-1 truncate">{status.label}</span>
                        <div className="flex items-center gap-2">
                          <div className="hidden sm:block h-1 w-14 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", status.color)}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold tabular-nums text-foreground w-8 text-left">
                            {formatNumber(value)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── Delivery (compact side by side) ─────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Delivery mini */}
          <Card className="rounded-2xl border-border">
            <CardContent className="p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">التوصيل</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {widgetsLoading ? "—" : `${deliveryPerformance?.on_time_rate?.toFixed(0) ?? 0}%`}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">في الوقت</p>
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {widgetsLoading ? "—" : `${deliveryPerformance?.avg_delivery_days?.toFixed(1) ?? 0} ي`}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">متوسط الأيام</p>
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {widgetsLoading ? "—" : deliveryPerformance?.total_delivered ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">تم التسليم</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Orders mini */}
          <Card className="rounded-2xl border-border">
            <CardContent className="p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <Package className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">أحدث الطلبات</p>
              </div>
              <div className="space-y-3">
                {widgetsLoading ? (
                  [...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-9 rounded-lg" />
                  ))
                ) : recentOrders.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    لا توجد طلبات حديثة
                  </div>
                ) : (
                  recentOrders.slice(0, 5).map((order) => {
                    const s = statusColors[order.status]
                    return (
                      <div key={order.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full shrink-0", s?.iconColor || "bg-muted")} />
                          <div className="text-right">
                            <p className="text-sm font-medium truncate max-w-[200px]">{order.customer}</p>
                            <p className="text-xs text-muted-foreground font-mono" dir="ltr">{order.id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-left">
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", s?.bg || "bg-muted")}>
                            {s?.text || order.status}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono" dir="ltr">{order.date}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
