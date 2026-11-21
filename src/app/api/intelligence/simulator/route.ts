import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { buildAnalytics } from '@/lib/analytics/engine'
import { simulate, SIMULATOR_LEVERS, type SimulatorLever, type SimulatorScenario } from '@/lib/intelligence/simulator'

export const dynamic = 'force-dynamic'

/**
 * POST /api/intelligence/simulator — what-if, non-destructive.
 *
 * The endpoint only READS the current period and returns arithmetic. It
 * writes nothing: a simulation can never change a business record.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json().catch(() => ({}))
    const params = request.nextUrl.searchParams
    const options = {
      dateRange: body.dateRange ?? params.get('dateRange'),
      from: body.from ?? params.get('from'),
      to: body.to ?? params.get('to'),
    }

    const scenarios: SimulatorScenario[] = Array.isArray(body.scenarios)
      ? body.scenarios
          .filter(
            (s: any) =>
              s &&
              typeof s.lever === 'string' &&
              typeof s.change === 'number' &&
              Number.isFinite(s.change) &&
              SIMULATOR_LEVERS.some(l => l.lever === s.lever),
          )
          .map((s: any) => ({ lever: s.lever as SimulatorLever, change: s.change }))
      : []

    const supabase = createServiceClient()
    const [overview, analytics] = await Promise.all([
      buildBusinessOverview(supabase, options),
      buildAnalytics(supabase, options),
    ])

    const byKey = overview.byKey
    const revenue = byKey.revenue?.value ?? 0
    const orders = byKey.total_orders?.value ?? 0
    const productCost = byKey.product_costs?.value ?? null
    const shippingCost = byKey.shipping_cost?.value ?? null
    const operatingExpenses = byKey.operating_expenses?.value ?? null
    const adSpend = byKey.advertising_spend?.value ?? null
    const deliveryRate = byKey.delivery_rate?.value ?? null
    const returnRate = byKey.return_rate?.value ?? null

    const result = simulate(
      {
        orders,
        revenue,
        averageOrderValue: byKey.average_order_value?.value ?? (orders > 0 ? revenue / orders : 0),
        productCost,
        shippingCost,
        operatingExpenses,
        adSpend,
        returnRate,
        deliveryRate: deliveryRate !== null ? deliveryRate / 100 : null,
        expensesNotRecorded: analytics.expensesNotRecorded,
      },
      scenarios
    )

    return NextResponse.json({
      window: { preset: overview.window.preset, label: overview.window.label },
      levers: SIMULATOR_LEVERS,
      result,
    })
  } catch (error) {
    console.error('Simulator error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run the simulation' },
      { status: 500 }
    )
  }
}
