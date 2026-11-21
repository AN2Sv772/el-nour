"use client"

import * as React from "react"
import { use, useState, useEffect } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowRight, Phone, MapPin, Package, ShoppingCart, Wallet } from "lucide-react"
import { formatCurrency, formatDate, formatDateTime, formatPhoneNumber, statusColors, cn } from "@/lib/utils"

interface CustomerDetail {
  id: string
  name?: string | null
  phone: string
  email?: string | null
  address?: string | null
  governorate?: string | null
  city?: string | null
  total_orders?: number
  total_spent?: number
  created_at: string
  last_order_at?: string | null
}

interface CustomerOrder {
  id: string
  order_number: string
  status: string
  total_amount: number
  created_at: string
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [custRes, ordersRes] = await Promise.all([
          fetch(`/api/customers?id=${encodeURIComponent(id)}`, { credentials: 'include' }),
          fetch(`/api/orders?customerId=${id}&pageSize=50&sortBy=created_at&sortOrder=desc`, { credentials: 'include' }),
        ])
        if (!custRes.ok) throw new Error('تعذر تحميل بيانات العميل')
        const custBody = await custRes.json()
        const found = (custBody.data || [])[0]
        if (!found) throw new Error('لم يتم العثور على العميل')
        if (cancelled) return
        setCustomer(found)

        if (ordersRes.ok) {
          const ordersBody = await ordersRes.json()
          if (!cancelled) setOrders(ordersBody.data || [])
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'حدث خطأ')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const totalSpent = orders
    .filter((o) => !['cancelled', 'returned'].includes(o.status))
    .reduce((sum, o) => sum + (o.total_amount || 0), 0)

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <PageHeader
          leading={
            <Link
              href="/customers"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="عودة للعملاء"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
          title={customer?.name || '...'}
          description={customer ? `عميل منذ ${formatDate(customer.created_at)}` : undefined}
        />

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        ) : customer ? (
          <>
            {/* Stats strip */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">إجمالي الطلبات</p>
                    <ShoppingCart className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{orders.length}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">إجمالي الإنفاق</p>
                    <Wallet className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(totalSpent)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">آخر طلب</p>
                    <Package className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {orders[0] ? formatDate(orders[0].created_at) : '—'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Contact info */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">بيانات التواصل</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 grid gap-3 sm:grid-cols-2 text-sm">
                <p className="flex items-center gap-2" dir="ltr">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatPhoneNumber(customer.phone)}
                </p>
                {customer.email && (
                  <p className="text-muted-foreground" dir="ltr">{customer.email}</p>
                )}
                {(customer.address || customer.city || customer.governorate) && (
                  <p className="flex items-center gap-2 text-muted-foreground sm:col-span-2">
                    <MapPin className="h-3.5 w-3.5" />
                    {[customer.address, customer.city, customer.governorate].filter(Boolean).join('، ')}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Orders */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">سجل الطلبات</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {orders.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد طلبات لهذا العميل بعد
                  </div>
                ) : (
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-xs text-muted-foreground">
                          <th className="text-right font-medium px-3 py-2">رقم الطلب</th>
                          <th className="text-center font-medium px-3 py-2">الحالة</th>
                          <th className="text-right font-medium px-3 py-2">التاريخ</th>
                          <th className="text-left font-medium px-3 py-2">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id} className="border-t border-border/40 hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2.5">
                              <Link href={`/orders/${o.id}`} className="font-mono text-xs hover:text-primary hover:underline" dir="ltr">
                                {o.order_number}
                              </Link>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", statusColors[o.status]?.bg || 'bg-muted')}>
                                {statusColors[o.status]?.text || o.status}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground text-xs">{formatDate(o.created_at)}</td>
                            <td className="px-3 py-2.5 text-left font-semibold tabular-nums">{formatCurrency(o.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="rounded-2xl border-border">
            <CardContent className="py-12 text-center text-muted-foreground">
              لم يتم العثور على العميل
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
