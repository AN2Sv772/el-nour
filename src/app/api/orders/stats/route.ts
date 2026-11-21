import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  applyOrderFilters,
  findOrderIdsByProductSearch,
  resolveOrderFilters,
} from '@/lib/orders/query'

export const dynamic = 'force-dynamic'

/**
 * GET /api/orders/stats
 *
 * Counters for the ORDERS TABLE — computed over exactly the same filter set
 * the table is showing, so a card can never disagree with the rows below it.
 *
 * Accepts the identical query parameters as `/api/orders`:
 *   search, status, paymentStatus, shippingStatus, customerId, productId,
 *   dateRange, from, to
 *
 * Returns:
 *   total            — orders matching the filters
 *   revenue         — sum of `total_amount` (cancelled/returned excluded)
 *   average_order   — revenue / total
 *   new_customers   — distinct customers inside the filtered orders
 *   by_status       — per-status counts inside the filtered set
 *   by_payment      — per-payment-status counts inside the filtered set
 *   period          — the resolved { from, to, preset } for display
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const filters = resolveOrderFilters({
      search: params.get('search'),
      status: params.get('status'),
      paymentStatus: params.get('paymentStatus'),
      shippingStatus: params.get('shippingStatus'),
      customerId: params.get('customerId'),
      productId: params.get('productId'),
      dateRange: params.get('dateRange'),
      from: params.get('from') ?? params.get('dateFrom'),
      to: params.get('to') ?? params.get('dateTo'),
    })

    // Product names live in `order_items`; PostgREST cannot mix an embedded
    // filter with a top-level `or()`, so the product branch is resolved to
    // order ids and injected into the search expression as `id.in.(...)`.
    // Without this the counters would describe a DIFFERENT set of orders
    // than the table (the exact "card and table disagree" bug).
    let productMatchIds: string[] | undefined
    if (filters.search) {
      productMatchIds = (await findOrderIdsByProductSearch(supabase, filters.search)).ids
    }

    const rows = await fetchAllRows<{
      id: string
      total_amount: number | null
      status: string
      payment_status: string
      customer_id: string | null
      created_at: string
    }>((from, to) => {
      let q = supabase
        .from('orders')
        .select('id, total_amount, status, payment_status, customer_id, created_at')
      q = applyOrderFilters(q, filters, { productMatchIds })
      return q.order('id', { ascending: true }).range(from, to)
    })

    const byStatus: Record<string, number> = {}
    const byPayment: Record<string, number> = {}
    const customerIds = new Set<string>()
    let revenue = 0
    let revenueCount = 0

    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
      byPayment[row.payment_status] = (byPayment[row.payment_status] ?? 0) + 1
      if (row.customer_id) customerIds.add(row.customer_id)
      // Cancelled and returned orders are not revenue.
      if (row.status !== 'cancelled' && row.status !== 'returned') {
        revenue += row.total_amount ?? 0
        revenueCount++
      }
    }

    return NextResponse.json({
      total: rows.length,
      revenue: Math.round(revenue * 100) / 100,
      average_order: revenueCount > 0 ? Math.round((revenue / revenueCount) * 100) / 100 : 0,
      new_customers: customerIds.size,
      by_status: byStatus,
      by_payment: byPayment,
      period: {
        preset: filters.dateRange.preset,
        from: filters.dateRange.from,
        to: filters.dateRange.to,
        label: filters.dateRange.label,
      },
    })
  } catch (error) {
    console.error('Orders stats error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch order stats' },
      { status: 500 }
    )
  }
}
