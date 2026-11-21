"use client"

export const dynamic = 'force-dynamic'

import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader, MetricBlock } from '@/components/shell/page-header'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Package,
  DollarSign,
  TrendingUp,
  Users,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  Download,
  Filter,
  X,
  Search,
  CalendarRange,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Layers,
  Trash2,
} from "lucide-react"
import { formatCurrency, formatNumber, cn, statusColors } from "@/lib/utils"
import { DATE_RANGE_PRESETS } from "@/lib/date-range"
import { useRealtimeRefresh } from "@/hooks/use-realtime"

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface OrderCustomer {
  id: string
  name: string | null
  phone: string | null
  governorate: string | null
  city: string | null
}

interface OrderItem {
  id: string
  product_id: string
  product_name: string
  variant_name: string | null
  sku: string
  quantity: number
  unit_price: number
  total_price: number
}

interface OrderRow {
  id: string
  order_number: string
  status: string
  payment_status: string
  payment_method: string | null
  subtotal: number | null
  discount_amount: number | null
  shipping_fee: number | null
  tax_amount: number | null
  total_amount: number | null
  source: string | null
  created_at: string
  updated_at: string
  customer_id: string | null
  tracking_number: string | null
  shipping_company: string | null
  customer: OrderCustomer | null
  items: OrderItem[]
}

interface OrdersResponse {
  data: OrderRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  productSearchTruncated?: boolean
  appliedFilters?: Record<string, unknown>
}

interface OrderStats {
  total: number
  revenue: number
  average_order: number
  new_customers: number
  by_status: Record<string, number>
  by_payment: Record<string, number>
  period: { preset: string; label: string; from: string | null; to: string | null }
}

const STATUS_OPTIONS = [
  { value: "pending", label: "قيد الانتظار" },
  { value: "awaiting_confirmation", label: "بانتظار التأكيد" },
  { value: "confirmed", label: "مؤكد" },
  { value: "preparing", label: "قيد التجهيز" },
  { value: "ready_for_shipping", label: "جاهز للشحن" },
  { value: "shipped", label: "تم الشحن" },
  { value: "out_for_delivery", label: "قيد التوصيل" },
  { value: "delivered", label: "تم التسليم" },
  { value: "cancelled", label: "ملغي" },
  { value: "returned", label: "مرتجع" },
  { value: "failed_delivery", label: "فشل التوصيل" },
]

const PAYMENT_OPTIONS = [
  { value: "pending", label: "غير مدفوع" },
  { value: "paid", label: "مدفوع" },
  { value: "partial", label: "مدفوع جزئياً" },
  { value: "refunded", label: "مسترجع" },
  { value: "failed", label: "فشل الدفع" },
]

const SHIPPING_OPTIONS = [
  { value: "not_shipped", label: "لم يتم الشحن" },
  { value: "in_transit", label: "في الطريق" },
  { value: "delivered", label: "تم التوصيل" },
  { value: "failed", label: "فشل التوصيل" },
  { value: "returned", label: "مرتجع" },
  { value: "cancelled", label: "ملغي" },
]

const PAYMENT_BADGES: Record<string, { bg: string; text: string }> = {
  paid: { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", text: "مدفوع" },
  partial: { bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", text: "جزئي" },
  refunded: { bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", text: "مسترجع" },
  failed: { bg: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", text: "فشل" },
  pending: { bg: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", text: "غير مدفوع" },
}

/* ------------------------------------------------------------------ */

export default function OrdersPage() {
  /* ---------------- filters ---------------- */
  const [dateRange, setDateRange] = useState("this_month")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [showCustomRange, setShowCustomRange] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [paymentFilter, setPaymentFilter] = useState("")
  const [shippingFilter, setShippingFilter] = useState("")
  const [productFilter, setProductFilter] = useState("")

  /* ---------------- data ---------------- */
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortBy, setSortBy] = useState("created_at")
  const [sortOrder, setSortOrder] = useState("desc")

  /* ---------------- selection ---------------- */
  const [selected, setSelected] = useState<string[]>([])
  const [allFilteredSelected, setAllFilteredSelected] = useState(false)
  const [bulkStatus, setBulkStatus] = useState("")
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  const selectAllRef = useRef<HTMLInputElement>(null)

  /* ---------------- derived ---------------- */
  const hasCustomRange = dateRange === "custom"
  const activeFilterCount =
    (search ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (paymentFilter ? 1 : 0) +
    (shippingFilter ? 1 : 0) +
    (productFilter ? 1 : 0) +
    (hasCustomRange ? 1 : 0)

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortOrder,
      dateRange: hasCustomRange ? "custom" : dateRange,
    })
    if (hasCustomRange) {
      if (customFrom) params.set("from", customFrom)
      if (customTo) params.set("to", customTo)
    }
    if (search) params.set("search", search)
    if (statusFilter) params.set("status", statusFilter)
    if (paymentFilter) params.set("paymentStatus", paymentFilter)
    if (shippingFilter) params.set("shippingStatus", shippingFilter)
    if (productFilter) params.set("productId", productFilter)
    return params
  }, [
    page, pageSize, sortBy, sortOrder, dateRange, hasCustomRange,
    customFrom, customTo, search, statusFilter, paymentFilter, shippingFilter, productFilter,
  ])

  /* ---------------- fetching ---------------- */
  const fetchData = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      try {
        setError(null)
        const [ordersRes, statsRes] = await Promise.all([
          fetch(`/api/orders?${queryParams.toString()}`),
          fetch(`/api/orders/stats?${queryParams.toString()}`),
        ])

        if (!ordersRes.ok) {
          const body = await ordersRes.json().catch(() => ({}))
          throw new Error(body.error || "تعذر تحميل الطلبات")
        }
        const ordersData: OrdersResponse = await ordersRes.json()
        setOrders(ordersData.data || [])
        setTotal(ordersData.total || 0)
        setTotalPages(ordersData.totalPages || 1)

        if (statsRes.ok) {
          setStats(await statsRes.json())
        }
      } catch (err) {
        console.error("Orders fetch error:", err)
        setError(err instanceof Error ? err.message : "تعذر تحميل البيانات")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [queryParams]
  )

  useEffect(() => {
    void fetchData("initial")
  }, [fetchData])

  // Debounce the search box so every keystroke does not hit the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Live refresh — the hook polls as a fallback when the realtime
  // publication does not include the orders table.
  const liveStatus = useRealtimeRefresh({
    onChange: () => void fetchData("refresh"),
    tables: ["orders"],
    pollIntervalMs: 30_000,
  })

  /* ---------------- selection helpers ---------------- */
  const pageIds = useMemo(() => orders.map((o) => o.id), [orders])
  const selectedOnPage = pageIds.filter((id) => selected.includes(id)).length
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected

  useEffect(() => {
    // The indeterminate state cannot be set through the JSX — it needs the
    // DOM property.
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someOnPageSelected
    }
  }, [someOnPageSelected])

  const toggleSelectAllOnPage = () => {
    setAllFilteredSelected(false)
    setSelected((prev) =>
      allOnPageSelected
        ? prev.filter((id) => !pageIds.includes(id))
        : Array.from(new Set([...prev, ...pageIds]))
    )
  }

  const toggleOrder = (id: string) => {
    setAllFilteredSelected(false)
    setSelected((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  /** Select every order matching the CURRENT filters (across all pages). */
  const selectAllFiltered = async () => {
    setBulkBusy(true)
    try {
      const res = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ids",
          filters: {
            search: search || null,
            status: statusFilter || null,
            paymentStatus: paymentFilter || null,
            shippingStatus: shippingFilter || null,
            productId: productFilter || null,
            dateRange: hasCustomRange ? "custom" : dateRange,
            from: hasCustomRange ? customFrom || null : null,
            to: hasCustomRange ? customTo || null : null,
          },
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "تعذر تحديد كل الطلبات")
      setSelected(body.ids || [])
      setAllFilteredSelected(true)
      setBulkResult(body.message || `تم تحديد ${body.count} طلب`)
    } catch (err) {
      setBulkResult(err instanceof Error ? err.message : "تعذر تنفيذ العملية")
    } finally {
      setBulkBusy(false)
    }
  }

  const clearSelection = () => {
    setSelected([])
    setAllFilteredSelected(false)
    setBulkResult(null)
  }

  /* ---------------- bulk actions ---------------- */
  const applyBulkStatus = async () => {
    if (!bulkStatus || selected.length === 0) return
    setBulkBusy(true)
    setBulkResult(null)
    try {
      const res = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_status", ids: selected, status: bulkStatus }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "تعذر تحديث الحالات")
      setBulkResult(body.message || "تم التحديث")
      if (body.failed === 0) {
        clearSelection()
        setBulkStatus("")
        await fetchData("refresh")
      }
    } catch (err) {
      setBulkResult(err instanceof Error ? err.message : "تعذر تنفيذ العملية")
    } finally {
      setBulkBusy(false)
    }
  }

  const exportOrders = async (onlySelected: boolean) => {
    const params = new URLSearchParams(queryParams)
    params.set("export", "true")
    params.delete("page")
    params.delete("pageSize")
    const res = await fetch(`/api/orders?${params.toString()}`)
    if (!res.ok) {
      setBulkResult("تعذر تصدير الملف")
      return
    }
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `orders-${new Date().toISOString().split("T")[0]}.xlsx`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const clearFilters = () => {
    setSearchInput("")
    setSearch("")
    setStatusFilter("")
    setPaymentFilter("")
    setShippingFilter("")
    setProductFilter("")
    setDateRange("this_month")
    setCustomFrom("")
    setCustomTo("")
    setShowCustomRange(false)
    setPage(1)
  }

  const changePage = (next: number) => {
    setPage(Math.min(Math.max(1, next), Math.max(1, totalPages)))
  }

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(column)
      setSortOrder("desc")
    }
    setPage(1)
  }

  const SortIndicator = ({ column }: { column: string }) =>
    sortBy === column ? (
      sortOrder === "asc" ? (
        <ChevronUp className="h-3.5 w-3.5 inline-block" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 inline-block" />
      )
    ) : null

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ─── Header ─── */}
        <PageHeader
          icon={Package}
          title={
            <span className="flex items-center gap-2">
              <span>الطلبات</span>
              {/* The connection state is the only thing that changes here, and
                  it changes without the user doing anything — so it needs to be
                  announced. `role="status"` gives one polite live region; only
                  one of the three spans is ever rendered, so they can never
                  compete as separate live regions. */}
              {liveStatus === "live" && (
                <span
                  role="status"
                  aria-atomic="true"
                  className="inline-flex items-center gap-1 rounded-md bg-success-muted px-1.5 py-0.5 text-[11px] font-medium text-success"
                >
                  <Wifi className="h-3 w-3" aria-hidden="true" /> مباشر
                </span>
              )}
              {liveStatus === "polling" && (
                <span
                  role="status"
                  aria-atomic="true"
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> تحديث تلقائي
                </span>
              )}
              {liveStatus === "offline" && (
                <span
                  role="status"
                  aria-atomic="true"
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  <WifiOff className="h-3 w-3" aria-hidden="true" /> غير متصل
                </span>
              )}
            </span>
          }
          description={
            stats ? `${stats.period.label} — ${formatNumber(stats.total)} طلب` : "إدارة ومتابعة جميع الطلبات"
          }
          actions={
            <>
              <Select
                value={hasCustomRange ? "custom" : dateRange}
                onValueChange={(v) => {
                  setDateRange(v)
                  if (v === "custom") setShowCustomRange(true)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-[150px]" data-testid="date-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGE_PRESETS.filter((p) => p.value !== "custom").map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">فترة مخصصة</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCustomRange((v) => !v)}
                aria-pressed={showCustomRange}
              >
                <CalendarRange className="h-4 w-4" />
                تواريخ
              </Button>

              <Button variant="outline" size="sm" onClick={() => void fetchData("refresh")} disabled={refreshing}>
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                تحديث
              </Button>

              <Button variant="outline" size="sm" onClick={() => void exportOrders(false)}>
                <Download className="h-4 w-4" />
                تصدير
              </Button>
            </>
          }
        />

        {/* ─── Custom range picker ─── */}
        {showCustomRange && (
          <Card className="rounded-xl border-border">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="range-from" className="text-xs font-medium text-muted-foreground">
                  من تاريخ
                </label>
                <Input
                  id="range-from"
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => {
                    setCustomFrom(e.target.value)
                    setDateRange("custom")
                    setPage(1)
                  }}
                  className="h-9 w-[170px] rounded-lg text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="range-to" className="text-xs font-medium text-muted-foreground">
                  إلى تاريخ
                </label>
                <Input
                  id="range-to"
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => {
                    setCustomTo(e.target.value)
                    setDateRange("custom")
                    setPage(1)
                  }}
                  className="h-9 w-[170px] rounded-lg text-sm"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  setCustomFrom("")
                  setCustomTo("")
                  setDateRange("this_month")
                }}
              >
                <X className="h-4 w-4" /> مسح
              </Button>
              <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
                تُحسب التواريخ بتوقيت القاهرة (Africa/Cairo)
              </p>
            </CardContent>
          </Card>
        )}

        {/* ─── Stats strip (same filters as the table) — one strip, not four
                boxes: the reference reads these as a single line of numbers. ── */}
        <div className="card grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricBlock
            label="إجمالي المبيعات"
            value={formatCurrency(stats?.revenue ?? 0)}
            icon={DollarSign}
            tone="neutral"
          />
          <MetricBlock
            label="الطلبات"
            value={formatNumber(stats?.total ?? 0)}
            icon={Package}
            tone="neutral"
          />
          <MetricBlock
            label="متوسط قيمة الطلب"
            value={formatCurrency(stats?.average_order ?? 0)}
            icon={TrendingUp}
            tone="neutral"
          />
          <MetricBlock
            label="العملاء"
            value={formatNumber(stats?.new_customers ?? 0)}
            icon={Users}
            tone="neutral"
          />
        </div>

        {/* ─── Filters ─── */}
        <Card className="rounded-xl border-border">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                <Input
                  placeholder="ابحث برقم الطلب، اسم العميل، الهاتف، رقم التتبع أو اسم المنتج…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pr-10 py-2"
                  aria-label="بحث في الطلبات"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={statusFilter || "all"}
                  onValueChange={(v) => {
                    setStatusFilter(v === "all" ? "" : v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-9 w-[145px] rounded-lg text-sm">
                    <SelectValue placeholder="الحالة" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="all">كل الحالات</SelectItem>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={paymentFilter || "all"}
                  onValueChange={(v) => {
                    setPaymentFilter(v === "all" ? "" : v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-9 w-[135px] rounded-lg text-sm">
                    <SelectValue placeholder="الدفع" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="all">كل حالات الدفع</SelectItem>
                    {PAYMENT_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={shippingFilter || "all"}
                  onValueChange={(v) => {
                    setShippingFilter(v === "all" ? "" : v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-9 w-[140px] rounded-lg text-sm">
                    <SelectValue placeholder="الشحن" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="all">كل مراحل الشحن</SelectItem>
                    {SHIPPING_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="h-4 w-4" />
                    مسح الفلاتر ({activeFilterCount})
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Error ─── */}
        {error && (
          // `role="alert"` so the failure is announced when it appears — a
          // silently rendered error card is invisible to a screen reader.
          <Card
            role="alert"
            className="rounded-xl border-destructive/40 bg-destructive/5"
          >
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <span className="text-sm">{error}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => void fetchData("initial")}>
                إعادة المحاولة
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ─── Bulk action bar ─── */}
        {selected.length > 0 && (
          <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              {formatNumber(selected.length)} طلب محدد
              {allFilteredSelected && <span className="text-muted-foreground">(كل النتائج المطابقة)</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 mr-auto">
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger className="h-8 w-[150px] rounded-lg text-xs">
                  <SelectValue placeholder="تغيير الحالة" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!bulkStatus || bulkBusy}
                onClick={() => setBulkOpen(true)}
              >
                {bulkBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                تطبيق
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void exportOrders(true)}>
                <Download className="h-3.5 w-3.5" />
                تصدير المحدد
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearSelection}>
                <Trash2 className="h-3.5 w-3.5" />
                إلغاء التحديد
              </Button>
            </div>
            {bulkResult && <span className="text-xs text-muted-foreground">{bulkResult}</span>}
          </div>
        )}

        {/* ─── Orders table ─── */}
        <Card className="rounded-xl border-border">
          <CardContent className="pt-4">
            {loading ? (
              <div className="space-y-3 p-4">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Package className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-foreground">لا توجد طلبات</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {activeFilterCount > 0
                    ? "جرب تعديل الفلاتر أو مسحها"
                    : "لم يتم العثور على طلبات في الفترة المحددة"}
                </p>
                {activeFilterCount > 0 && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                    مسح الفلاتر
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* "select all filtered" banner */}
                {allOnPageSelected && !allFilteredSelected && total > pageIds.length && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      تم تحديد كل الطلبات في هذه الصفحة ({formatNumber(pageIds.length)} من{" "}
                      {formatNumber(total)})
                    </span>
                    <Button variant="link" size="sm" className="h-auto p-0 text-sm" disabled={bulkBusy} onClick={() => void selectAllFiltered()}>
                      تحديد كل النتائج المطابقة ({formatNumber(total)})
                    </Button>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="w-12 px-3 py-2">
                          {/* The visual checkbox stays 16px (it sits in a dense
                              table), but WCAG 2.2 SC 2.5.8 requires a 24px
                              pointer target. The padded <label> wrapper gives
                              a 28x28 hit area while keeping the 16px glyph,
                              and clicking the padding toggles the box. */}
                          <label className="inline-flex cursor-pointer items-center justify-center p-1.5 -m-1.5">
                            <input
                              ref={selectAllRef}
                              type="checkbox"
                              checked={allOnPageSelected}
                              onChange={toggleSelectAllOnPage}
                              aria-label="تحديد كل الطلبات في الصفحة"
                              className="h-4 w-4 cursor-pointer rounded border-border text-primary focus:ring-primary"
                            />
                          </label>
                        </th>
                        <th
                          className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none"
                          onClick={() => toggleSort("order_number")}
                        >
                          رقم الطلب
                          <SortIndicator column="order_number" />
                        </th>
                        <th className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
                          العميل
                        </th>
                        <th className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
                          المنتجات
                        </th>
                        <th
                          className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none"
                          onClick={() => toggleSort("total_amount")}
                        >
                          المبلغ
                          <SortIndicator column="total_amount" />
                        </th>
                        <th
                          className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none"
                          onClick={() => toggleSort("status")}
                        >
                          الحالة
                          <SortIndicator column="status" />
                        </th>
                        <th
                          className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none"
                          onClick={() => toggleSort("payment_status")}
                        >
                          الدفع
                          <SortIndicator column="payment_status" />
                        </th>
                        <th className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
                          الشحن
                        </th>
                        <th
                          className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none"
                          onClick={() => toggleSort("created_at")}
                        >
                          التاريخ
                          <SortIndicator column="created_at" />
                        </th>
                        <th className="w-20 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {orders.map((order) => {
                        const statusInfo = statusColors[order.status] || {
                          bg: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
                          text: order.status,
                        }
                        const paymentInfo = PAYMENT_BADGES[order.payment_status] || PAYMENT_BADGES.pending
                        const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0)

                        return (
                          <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2.5">
                              <label className="inline-flex cursor-pointer items-center justify-center p-1.5 -m-1.5">
                                <input
                                  type="checkbox"
                                  checked={selected.includes(order.id)}
                                  onChange={() => toggleOrder(order.id)}
                                  aria-label={`تحديد الطلب ${order.order_number}`}
                                  className="h-4 w-4 cursor-pointer rounded border-border text-primary focus:ring-primary"
                                />
                              </label>
                            </td>
                            <td className="px-3 py-2.5">
                              <Link
                                href={`/orders/${order.id}`}
                                className="inline-block py-1 -my-1 font-mono text-sm font-medium text-foreground hover:text-primary hover:underline"
                              >
                                {order.order_number}
                              </Link>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="text-sm font-medium text-foreground">
                                {order.customer?.name || order.customer?.phone || "—"}
                              </div>
                              {order.customer?.phone && (
                                <div className="text-xs text-muted-foreground" dir="ltr">
                                  {order.customer.phone}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-sm text-muted-foreground">
                              <span className="whitespace-nowrap">
                                {formatNumber(itemCount)} قطعة
                              </span>
                              {order.items?.length > 0 && (
                                <div className="max-w-[180px] truncate text-xs text-muted-foreground">
                                  {order.items[0].product_name}
                                  {order.items.length > 1 ? ` +${order.items.length - 1}` : ""}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-sm text-foreground whitespace-nowrap">
                              {formatCurrency(order.total_amount ?? 0)}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                                  statusInfo.bg
                                )}
                              >
                                {statusInfo.text}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                                  paymentInfo.bg
                                )}
                              >
                                {paymentInfo.text}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-sm text-muted-foreground">
                              <div>{order.shipping_company || "—"}</div>
                              {order.tracking_number && (
                                <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                                  {order.tracking_number}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-sm text-muted-foreground font-mono whitespace-nowrap" dir="ltr">
                              {new Date(order.created_at).toLocaleDateString("ar-EG", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </td>
                            <td className="px-3 py-2.5">
                              <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                <Link href={`/orders/${order.id}`} aria-label={`تفاصيل الطلب ${order.order_number}`}>
                                  <ExternalLink className="h-4 w-4" />
                                </Link>
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ─── Pagination ─── */}
            {!loading && orders.length > 0 && (
              <div className="flex flex-col gap-3 px-4 py-4 border-t border-border/50 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  عرض {formatNumber(from)} – {formatNumber(to)} من {formatNumber(total)} طلب
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v))
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="h-8 w-[80px] rounded-lg text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {[10, 25, 50, 100].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => changePage(page - 1)}
                    disabled={page <= 1}
                    aria-label="الصفحة السابقة"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground min-w-[70px] text-center">
                    صفحة {page} من {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => changePage(page + 1)}
                    disabled={page >= totalPages}
                    aria-label="الصفحة التالية"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Bulk confirmation dialog ─── */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>تأكيد تغيير الحالة</DialogTitle>
            <DialogDescription>
              سيتم تغيير حالة {formatNumber(selected.length)} طلب إلى
              {" "}
              {STATUS_OPTIONS.find((s) => s.value === bulkStatus)?.label}. هذا الإجراء يؤثر على الطلبات
              المحددة فقط.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              إلغاء
            </Button>
            <Button
              disabled={bulkBusy}
              onClick={async () => {
                await applyBulkStatus()
                setBulkOpen(false)
              }}
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
