import { NextRequest, NextResponse } from 'next/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Base query: any order that has been (or should have been) delivered
    let query = supabase
      .from('orders')
      .select('status, created_at, shipped_at, delivered_at, shipping_company')
      .in('status', ['delivered', 'shipped', 'out_for_delivery', 'failed_delivery'])

    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo)

    // Paginated: PostgREST returns at most 1000 rows per response.
    const ordersList = await fetchAllRows<{
      status: string
      created_at: string
      shipped_at: string | null
      delivered_at: string | null
      shipping_company: string | null
    }>((from, to) => query.order('id', { ascending: true }).range(from, to))

    // Calculate on-time delivery rate
    const deliveredOrders = ordersList.filter(o => o.status === 'delivered')
    let onTimeCount = 0
    let totalDeliveryDays = 0
    let lateCount = 0
    let failedCount = 0

    for (const order of deliveredOrders) {
      if (order.shipped_at && order.delivered_at) {
        const shipped = new Date(order.shipped_at)
        const delivered = new Date(order.delivered_at)
        const days = (delivered.getTime() - shipped.getTime()) / (1000 * 60 * 60 * 24)
        totalDeliveryDays += days
        // Consider on-time if delivered within 5 days of shipping
        if (days <= 5) onTimeCount++
        else lateCount++
      }
    }

    // Count failed deliveries
    const failedOrders = ordersList.filter(o => o.status === 'failed_delivery')
    failedCount = failedOrders.length

    // Count currently late orders (shipped but not delivered within expected time)
    const shippedOrders = ordersList.filter(o => o.status === 'shipped' || o.status === 'out_for_delivery')
    for (const order of shippedOrders) {
      if (order.shipped_at) {
        const shipped = new Date(order.shipped_at)
        const now = new Date()
        const days = (now.getTime() - shipped.getTime()) / (1000 * 60 * 60 * 24)
        if (days > 5) lateCount++
      }
    }

    const onTimeRate = deliveredOrders.length > 0 ? (onTimeCount / deliveredOrders.length) * 100 : 0
    const avgDeliveryDays = deliveredOrders.length > 0 ? totalDeliveryDays / deliveredOrders.length : 0

    return NextResponse.json({
      data: {
        on_time_rate: Math.round(onTimeRate * 10) / 10,
        avg_delivery_days: Math.round(avgDeliveryDays * 10) / 10,
        late_orders: lateCount,
        failed_deliveries: failedCount,
        total_delivered: deliveredOrders.length,
        total_shipped: shippedOrders.length,
      }
    })
  } catch (error) {
    console.error('Delivery performance error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch delivery performance' },
      { status: 500 }
    )
  }
}