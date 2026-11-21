import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { businessDateString } from '@/lib/date-range'
import { forecastDemand } from '@/lib/intelligence/forecast'

export const dynamic = 'force-dynamic'

/**
 * GET /api/intelligence/forecast — demand forecast with a measured error.
 *
 * The response carries the method, the backtest error and the assumptions, so
 * the owner can judge how much to trust it. It is a baseline, not a model,
 * and it says so.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams
    const options = {
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    }
    const horizon = Math.max(1, Math.min(90, Number(params.get('horizon') ?? 14)))
    const overview = await buildBusinessOverview(supabase, options)

    // 120 days of history for the backtest, regardless of the display window.
    const now = new Date()
    const fromDay = businessDateString(new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000))
    const toDay = businessDateString(now)
    const history = await buildBusinessOverview(supabase, { from: fromDay, to: toDay })
    const series = history.series.map(d => ({ date: d.date, orders: d.orders, revenue: d.revenue }))

    const aov = overview.byKey.average_order_value?.value ?? 0
    const inventoryTracked = (overview.byKey.inventory_units?.provenance.status ?? 'unavailable') === 'actual'

    const productUnits = overview.products
      .filter(p => p.units > 0)
      .map(p => ({
        productId: p.productId,
        name: p.name,
        units: p.units,
        days: Math.max(1, series.length),
      }))

    const result = forecastDemand({
      series,
      horizonDays: horizon,
      averageOrderValue: aov,
      inventoryTracked,
      productUnits,
    })

    return NextResponse.json({
      window: { preset: overview.window.preset, label: overview.window.label },
      historyDays: series.length,
      result,
    })
  } catch (error) {
    console.error('Forecast error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the forecast' },
      { status: 500 }
    )
  }
}
