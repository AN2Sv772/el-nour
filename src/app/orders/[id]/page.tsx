"use client"

import * as React from "react"
import { use, useState, useEffect } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ArrowRight,
  MapPin,
  Phone,
  User,
  Package,
  CreditCard,
  Truck,
  Loader2,
  Hash,
  StickyNote,
  Building2,
  AlertCircle,
} from "lucide-react"
import { WhatsAppLink } from "@/components/shared/whatsapp-link"
import { CopyButton } from "@/components/ui/copy-button"
import { useRealtimeRefresh } from "@/hooks/use-realtime"
import { formatCurrency, formatDate, formatDateTime, formatPhoneNumber, statusColors, cn } from "@/lib/utils"
import type { Order, OrderStatus } from "@/types"

const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'awaiting_confirmation', label: 'بانتظار التأكيد' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'preparing', label: 'قيد التجهيز' },
  { value: 'ready_for_shipping', label: 'جاهز للشحن' },
  { value: 'shipped', label: 'تم الشحن' },
  { value: 'out_for_delivery', label: 'قيد التوصيل' },
  { value: 'delivered', label: 'تم التسليم' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'returned', label: 'مرتجع' },
  { value: 'failed_delivery', label: 'فشل التوصيل' },
]

interface OrderItemRow {
  id: string
  product_name: string
  product_name_ar?: string | null
  sku: string
  variant_name?: string | null
  quantity: number
  unit_price: number
  discount: number
  total_price: number
}

interface OrderDetail {
  id: string
  order_number: string
  status: OrderStatus
  payment_status: string
  payment_method: string
  subtotal: number
  discount_amount: number
  shipping_fee: number
  tax_amount: number
  total_amount: number
  notes?: string | null
  internal_notes?: string | null
  cancellation_reason?: string | null
  source?: string | null
  tracking_number?: string | null
  shipping_company?: string | null
  created_at: string
  updated_at?: string
  customer?: { id: string; name?: string | null; phone: string } | null
  items?: OrderItemRow[]
  status_history?: { id: string; to_status: string; created_at: string; notes?: string | null }[]
  shipping_address?: {
    name?: string
    phone?: string
    address?: string
    city?: string
    governorate?: string
    landmark?: string | null
    postal_code?: string | null
  } | null
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [updating, setUpdating] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${id}`, { credentials: "include" })
      if (res.status === 404) {
        setNotFound(true)
        setError("")
        return
      }
      if (!res.ok) throw new Error("تعذر تحميل الطلب")
      const body = await res.json()
      setOrder(body.data)
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      await load()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [load])

  // The order can change while the page is open (a webhook delivery, or a
  // colleague updating it) — refresh in place.
  useRealtimeRefresh({
    onChange: () => void load(),
    tables: ["orders"],
    pollIntervalMs: 60_000,
  })

  const handleStatusChange = async (status: OrderStatus) => {
    if (!order) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        credentials: 'include',
      })
      if (!res.ok) throw new Error('فشل تحديث حالة الطلب')
      setOrder({ ...order, status })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ')
    } finally {
      setUpdating(false)
    }
  }

  const s = order ? statusColors[order.status] : undefined

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <PageHeader
          leading={
            <Link
              href="/orders"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="عودة للطلبات"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
          title={
            <span className="flex items-center gap-2">
              <span>طلب</span>
              <span dir="ltr" className="font-mono">{order?.order_number || "..."}</span>
              {order?.order_number && (
                <CopyButton value={order.order_number} aria-label="نسخ رقم الطلب" />
              )}
            </span>
          }
          description={
            order
              ? `${formatDateTime(order.created_at)} • المصدر: ${order.source === 'easyorders' ? 'EasyOrders' : 'يدوي'}`
              : undefined
          }
          actions={
            order ? (
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium", s?.bg || "bg-muted")}>
                  {s?.text || order.status}
                </span>
                <Select value={order.status} onValueChange={(v) => handleStatusChange(v as OrderStatus)} disabled={updating}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="تغيير الحالة" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.map((st) => (
                      <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {updating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            ) : undefined
          }
        />

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : notFound ? (
          <Card className="rounded-2xl border-border">
            <CardContent className="py-16 text-center">
              <AlertCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-lg font-medium text-foreground">الطلب غير موجود</p>
              <p className="text-sm text-muted-foreground mt-1">
                قد يكون رقم الطلب غير صحيح أو تم حذفه.
              </p>
              <Button variant="outline" size="sm" className="mt-4" asChild>
                <Link href="/orders">عودة إلى الطلبات</Link>
              </Button>
            </CardContent>
          </Card>
        ) : order ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Items */}
            <Card className="lg:col-span-2 rounded-2xl border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  عناصر الطلب
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground">
                        <th className="text-right font-medium px-3 py-2">المنتج</th>
                        <th className="text-center font-medium px-3 py-2">الكمية</th>
                        <th className="text-center font-medium px-3 py-2">السعر</th>
                        <th className="text-left font-medium px-3 py-2">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.items || []).map((item) => (
                        <tr key={item.id} className="border-t border-border/40">
                          <td className="px-3 py-2.5">
                            <p className="font-medium">{item.product_name_ar || item.product_name}</p>
                            <p className="text-xs text-muted-foreground font-mono" dir="ltr">{item.sku}</p>
                            {item.variant_name && (
                              <p className="text-xs text-muted-foreground">{item.variant_name}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center tabular-nums">{item.quantity}</td>
                          <td className="px-3 py-2.5 text-center tabular-nums">{formatCurrency(item.unit_price)}</td>
                          <td className="px-3 py-2.5 text-left font-semibold tabular-nums">{formatCurrency(item.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>المجموع الفرعي</span>
                    <span className="tabular-nums">{formatCurrency(order.subtotal)}</span>
                  </div>
                  {order.discount_amount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>الخصم</span>
                      <span className="tabular-nums text-destructive">-{formatCurrency(order.discount_amount)}</span>
                    </div>
                  )}
                  {order.shipping_fee > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>الشحن</span>
                      <span className="tabular-nums">{formatCurrency(order.shipping_fee)}</span>
                    </div>
                  )}
                  {order.tax_amount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>الضريبة</span>
                      <span className="tabular-nums">{formatCurrency(order.tax_amount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span>الإجمالي</span>
                    <span className="tabular-nums">{formatCurrency(order.total_amount)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Side panel */}
            <div className="space-y-4">
              {/* Customer */}
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    العميل
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-sm">
                  {order.customer ? (
                    <>
                      <Link href={`/customers/${order.customer.id}`} className="font-medium hover:text-primary hover:underline">
                        {order.customer.name || 'بدون اسم'}
                      </Link>
                      <p className="flex items-center gap-2 text-muted-foreground" dir="ltr">
                        <Phone className="h-3.5 w-3.5" />
                        {formatPhoneNumber(order.customer.phone)}
                        <CopyButton value={order.customer.phone} aria-label="نسخ رقم الهاتف" />
                        <WhatsAppLink phone={order.customer.phone} />
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">لا توجد بيانات عميل</p>
                  )}
                </CardContent>
              </Card>

              {/* Shipping address */}
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    عنوان الشحن
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground space-y-0.5">
                  {order.shipping_address ? (
                    <>
                      <p className="text-foreground font-medium">{order.shipping_address.name}</p>
                      {order.shipping_address.phone && (
                        <p className="flex items-center gap-2" dir="ltr">
                          {formatPhoneNumber(order.shipping_address.phone)}
                          <WhatsAppLink phone={order.shipping_address.phone} />
                        </p>
                      )}
                      <p>{order.shipping_address.address}</p>
                      <p>{[order.shipping_address.city, order.shipping_address.governorate].filter(Boolean).join('، ')}</p>
                      {order.shipping_address.landmark && (
                        <p className="text-xs">علامة مميزة: {order.shipping_address.landmark}</p>
                      )}
                      {order.tracking_number && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          <Hash className="h-3.5 w-3.5" />
                          <span className="text-muted-foreground">رقم التتبع:</span>
                          <span className="font-mono" dir="ltr">{order.tracking_number}</span>
                          <CopyButton value={order.tracking_number} aria-label="نسخ رقم التتبع" />
                        </div>
                      )}
                      {order.shipping_company && (
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <Building2 className="h-3.5 w-3.5" />
                          <span className="text-muted-foreground">شركة الشحن:</span>
                          <span>{order.shipping_company}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p>لا يوجد عنوان</p>
                  )}
                </CardContent>
              </Card>

              {/* Payment */}
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    الدفع
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm space-y-1">
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">الطريقة</span>
                    <span>{order.payment_method === 'cash_on_delivery' ? 'الدفع عند الاستلام' : order.payment_method}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">الحالة</span>
                    <span>{order.payment_status === 'pending' ? 'غير مدفوع' : order.payment_status === 'paid' ? 'مدفوع' : order.payment_status}</span>
                  </p>
                </CardContent>
              </Card>

              {/* Notes */}
              {(order.notes || order.cancellation_reason) && (
                <Card className="rounded-2xl border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <StickyNote className="h-4 w-4 text-muted-foreground" />
                      ملاحظات
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
                    {order.notes && <p className="whitespace-pre-wrap">{order.notes}</p>}
                    {order.cancellation_reason && (
                      <p className="text-destructive">سبب الإلغاء: {order.cancellation_reason}</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Status history */}
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    سجل الحالة
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {(order.status_history || []).length > 0 ? (
                    <ol className="space-y-2 text-sm">
                      {order.status_history!.slice(0, 8).map((h) => (
                        <li key={h.id} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          <div>
                            <p>{statusColors[h.to_status]?.text || h.to_status}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(h.created_at)}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted-foreground">لا يوجد سجل</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card className="rounded-2xl border-border">
            <CardContent className="py-12 text-center text-muted-foreground">
              لم يتم العثور على الطلب
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}

function Separator() {
  return <div className="h-px bg-border/60" role="separator" />
}
