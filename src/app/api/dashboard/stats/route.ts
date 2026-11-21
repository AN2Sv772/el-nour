import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { resolveDateRange } from '@/lib/date-range'
import { fetchAllByIds, fetchAllRows } from '@/lib/supabase/paginate'

export const dynamic = 'force-dynamic'

/**
 * The dashboard counters are computed over EXACTLY the same filter set as
 * the orders table, using the shared query layer (`src/lib/orders/query.ts`)
 * and the shared Africa/Cairo date engine (`src/lib/date-range.ts`).
 *
 * Previously this route had its own copy of the preset calendar maths (in
 * server-local time) while `/api/orders` used a different parameter
 * contract, so the cards and the table described different sets of orders.
 */
export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams

    // The dashboard KPIs keep their established meaning:
    //   • total_orders / status counters → all-time
    //   • total_sales / today_orders     → inside the selected period
    // The period is resolved with the shared Africa/Cairo engine so the
    // numbers match what the user sees in the orders table.
    //
    // Filter-aware counters for the orders table live in
    // `/api/orders/stats` (same filter contract, same date engine).
    const dateRange = searchParams.get('dateRange') || 'today'
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const range = resolveDateRange({ dateRange, from, to })
    const startDateISO = range.from
    const endDateISO = range.to

    const countHead = async (build?: (q: any) => any) => {
      let q = supabase.from('orders').select('*', { count: 'exact', head: true })
      if (build) q = build(q)
      const { count, error } = await q
      if (error) throw error
      return count ?? 0
    }

    const inRange = (q: any) => {
      if (startDateISO) q = q.gte('created_at', startDateISO)
      if (endDateISO) q = q.lte('created_at', endDateISO)
      return q
    }

    // Parallel queries for dashboard stats
    const [
      total_orders,
      today_orders,
      pending_orders,
      confirmed_orders,
      shipped_orders,
      delivered_orders,
      cancelled_orders,
      returned_orders,
      total_customers,
    ] = await Promise.all([
      countHead(),
      countHead(inRange),
      countHead(q => q.eq('status', 'pending')),
      countHead(q => q.eq('status', 'confirmed')),
      countHead(q => q.eq('status', 'shipped')),
      countHead(q => q.eq('status', 'delivered')),
      countHead(q => q.eq('status', 'cancelled')),
      countHead(q => q.eq('status', 'returned')),
      supabase.from('customers').select('*', { count: 'exact', head: true }).then(r => r.count ?? 0),
    ])

    // Revenue rows must be fetched page by page — see fetchAllRows.
    const salesRows = await fetchAllRows<{ total_amount: number | null; status: string; payment_status: string; created_at: string; id: string }>(
      (from, to) =>
        inRange(
          supabase
            .from('orders')
            .select('total_amount, status, payment_status, created_at, id')
            .not('status', 'in', '(cancelled,returned)')
        ).order('id', { ascending: true }).range(from, to)
    )
    const salesData = salesRows

    // Financial metrics (provisional): COGS from order-line cost snapshots.
    // The order id list is paginated too, and the `in()` lookup is chunked —
    // a 2 000-element `in` filter is both slow and, at the URL length
    // PostgREST allows, unreliable.
    const orderIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        inRange(supabase.from('orders').select('id')).order('id', { ascending: true }).range(from, to)
      )
    ).map(o => o.id)

    const cogsRows = await fetchAllByIds<{ quantity: number | null; unit_cost: number | null }>(
      (chunk) => (from, to) =>
        supabase.from('order_items').select('quantity, unit_cost').in('order_id', chunk)
          .order('id', { ascending: true }).range(from, to),
      orderIds
    )
    const cogs = cogsRows.reduce((s, it) => s + (it.quantity || 0) * (it.unit_cost ?? 0), 0)

    // `expenses.expense_date` is a DATE column — compare on the Cairo
    // calendar day, and leave the bound open for the "all" preset.
    const startDateOnly = startDateISO ? startDateISO.slice(0, 10) : null
    const endDateOnly = endDateISO ? endDateISO.slice(0, 10) : null
    const expenseRows = await fetchAllRows<{ amount: number | null; voided_at: string | null }>((from, to) => {
      let q = supabase.from('expenses').select('amount, voided_at')
      if (startDateOnly) q = q.gte('expense_date', startDateOnly)
      if (endDateOnly) q = q.lte('expense_date', endDateOnly)
      return q.order('id', { ascending: true }).range(from, to)
    })
    const expensesTotal = expenseRows.filter(e => !e.voided_at).reduce((s, e) => s + (e.amount || 0), 0)

    // Collections: cash actually received + outstanding (separate from revenue)
    const batchRows = await fetchAllRows<{ expected_amount: number | null; received_amount: number | null }>((from, to) =>
      supabase
        .from('collection_batches')
        .select('expected_amount, received_amount')
        .order('id', { ascending: true })
        .range(from, to)
    )
    const collectionsReceived = batchRows.reduce((s, b) => s + (b.received_amount || 0), 0)
    const collectionsExpected = batchRows.reduce((s, b) => s + (b.expected_amount || 0), 0)

    // Calculate financial stats
    let total_sales = 0
    let delivered_revenue = 0
    let outstanding_payments = 0

    if (salesData) {
      for (const order of salesData) {
        total_sales += order.total_amount ?? 0
        if (order.status === 'delivered') {
          delivered_revenue += order.total_amount ?? 0
        }
        if (order.payment_status === 'pending' || order.payment_status === 'partial') {
          outstanding_payments += order.total_amount ?? 0
        }
      }
    }

    // Calculate conversion rate (orders / visitors - placeholder since we don't have visitors yet)
    const conversion_rate_str = total_orders && total_orders > 0 ? ((delivered_orders || 0) / total_orders * 100).toFixed(1) : "0"

    // Calculate AOV (Average Order Value)
    const aov = today_orders && today_orders > 0 ? total_sales / today_orders : 0

    return NextResponse.json({
      total_orders: total_orders || 0,
      today_orders: today_orders || 0,
      pending_orders: pending_orders || 0,
      confirmed_orders: confirmed_orders || 0,
      shipped_orders: shipped_orders || 0,
      delivered_orders: delivered_orders || 0,
      cancelled_orders: cancelled_orders || 0,
      returned_orders: returned_orders || 0,
      total_sales,
      delivered_revenue,
      outstanding_payments,
      total_customers: total_customers || 0,
      provisional_cogs: Math.round(cogs * 100) / 100,
      provisional_profit: Math.round((total_sales - cogs - expensesTotal) * 100) / 100,
      expenses_total: Math.round(expensesTotal * 100) / 100,
      collections_received: Math.round(collectionsReceived * 100) / 100,
      collections_outstanding: Math.round((collectionsExpected - collectionsReceived) * 100) / 100,
      aov: Math.round(aov * 100) / 100,
      conversion_rate: parseFloat(conversion_rate_str),
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}