import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { fetchOrdersWithCustomers, resolveWindow } from '@/lib/intelligence/server'
import { assessOrders, buildHistories } from '@/lib/intelligence/risk'

export const dynamic = 'force-dynamic'

/**
 * GET /api/intelligence/risk — COD risk per open order.
 *
 * Read-only. The engine NEVER rejects an order: it ranks what a human should
 * verify, with the evidence attached.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams
    const range = resolveWindow({
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    })

    const orders = await fetchOrdersWithCustomers(supabase, range.from, range.to, {
      limit: Number(params.get('limit') ?? 300),
    })

    // The history is built from ALL the orders the store ever had (an old
    // refusal still matters today), while the scoring focuses on the window.
    const allOrders = await fetchOrdersWithCustomers(supabase, null, null, { limit: 5000 })
    const histories = buildHistories(allOrders)

    const open = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    const summary = assessOrders(open, histories)

    return NextResponse.json({
      window: { preset: range.preset, label: range.label, from: range.from, to: range.to },
      ...summary,
    })
  } catch (error) {
    console.error('Risk error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to assess risk' },
      { status: 500 }
    )
  }
}
