import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { resolveDateRange, businessDateString } from '@/lib/date-range'
import { parseDateParam } from '@/lib/api-params'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams
    const dateRange = searchParams.get('dateRange') || 'month'
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    // A malformed custom date used to reach `new Date('not-a-date')` and blow
    // up in `toISOString()` with "Invalid time value" (HTTP 500). Validate it
    // as a real calendar date first.
    const parsedFrom = parseDateParam(from, 'تاريخ البداية')
    if (!parsedFrom.ok) {
      return NextResponse.json({ error: parsedFrom.error }, { status: 400 })
    }
    const parsedTo = parseDateParam(to, 'تاريخ النهاية')
    if (!parsedTo.ok) {
      return NextResponse.json({ error: parsedTo.error }, { status: 400 })
    }

    // One shared, DST-safe Africa/Cairo engine — the same one the orders
    // table and the dashboard counters use, so the chart always describes the
    // same period as the numbers above it.
    const range = resolveDateRange({
      dateRange,
      from: parsedFrom.value,
      to: parsedTo.value,
    })
    const startDateISO = range.from
    const endDateISO = range.to

    const orders = await fetchAllRows<{ created_at: string; total_amount: number | null; status: string; payment_status: string }>(
      (from, to) => {
        let q = supabase
          .from('orders')
          .select('created_at, total_amount, status, payment_status')
          .in('status', ['delivered', 'shipped', 'confirmed'])
          .order('id', { ascending: true })
        if (startDateISO) q = q.gte('created_at', startDateISO)
        if (endDateISO) q = q.lte('created_at', endDateISO)
        return q.range(from, to)
      }
    )

    // Aggregate sales by business day (Africa/Cairo), so the labels line up
    // with the business day the orders table shows.
    const salesByDate: Record<string, { orders: number; revenue: number }> = {}
    for (const order of orders) {
      const date = businessDateString(new Date(order.created_at))
      if (!salesByDate[date]) {
        salesByDate[date] = { orders: 0, revenue: 0 }
      }
      salesByDate[date].orders++
      salesByDate[date].revenue += order.total_amount ?? 0
    }

    // Sort by date
    const sortedDates = Object.keys(salesByDate).sort()

    return NextResponse.json({
      range,
      data: {
        labels: sortedDates,
        datasets: [
          {
            label: 'المبيعات',
            data: sortedDates.map(d => salesByDate[d].revenue),
            backgroundColor: 'rgba(59, 130, 246, 0.5)',
            borderColor: 'rgb(59, 130, 246)',
          },
          {
            label: 'عدد الطلبات',
            data: sortedDates.map(d => salesByDate[d].orders),
            backgroundColor: 'rgba(16, 185, 129, 0.5)',
            borderColor: 'rgb(16, 185, 129)',
          },
        ],
      },
    })
  } catch (error) {
    console.error('Sales chart error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch sales chart data' },
      { status: 500 }
    )
  }
}