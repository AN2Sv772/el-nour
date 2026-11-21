import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { fetchOrdersWithCustomers, resolveWindow } from '@/lib/intelligence/server'
import { detectAnomalies, type AnomalyInput } from '@/lib/intelligence/anomaly'

export const dynamic = 'force-dynamic'

/**
 * GET /api/intelligence/anomalies — what changed and what to check.
 *
 * Read-only. Every anomaly carries its baseline, its actual value and the
 * first thing to verify.
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
    const range = resolveWindow(options)
    const overview = await buildBusinessOverview(supabase, options)

    const orders = await fetchOrdersWithCustomers(supabase, range.from, range.to, { limit: 5000 })

    // The average shipping fee actually charged.
    const fees = orders.map(o => Number((o as any).shipping_fee ?? 0)).filter(f => f > 0)
    const averageShippingFee = fees.length > 0 ? fees.reduce((s, f) => s + f, 0) / fees.length : null

    // The configured fixed fee (business_settings).
    let configuredShippingFee: number | null = null
    const { data: settings } = await supabase
      .from('business_settings')
      .select('default_shipping_fee')
      .limit(1)
      .maybeSingle()
    if (settings?.default_shipping_fee != null) {
      configuredShippingFee = Number(settings.default_shipping_fee)
    }

    const now = Date.now()
    const aged = orders.filter(o => {
      const ageDays = (now - new Date(o.createdAt).getTime()) / (24 * 60 * 60 * 1000)
      return ageDays > 30 && o.status !== 'delivered' && o.status !== 'cancelled'
    })

    const totalRevenue = overview.byKey.revenue?.value ?? 0
    const topProductShare =
      totalRevenue > 0 && overview.topProducts.length > 0
        ? (overview.topProducts[0].revenue ?? 0) / totalRevenue
        : null

    const input: AnomalyInput = {
      series: overview.series.map(d => ({ date: d.date, orders: d.orders, revenue: d.revenue })),
      totalOrders: overview.byKey.total_orders?.value ?? 0,
      deliveredOrders: overview.byKey.delivered_orders?.value ?? 0,
      pendingOrders: overview.byKey.pending_orders?.value ?? 0,
      ordersWithoutPaymentState: orders.filter(o => !o.paymentStatus || o.paymentStatus === 'pending').length,
      averageShippingFee,
      configuredShippingFee,
      topProductShare,
      dataCompleteness: overview.byKey.data_completeness?.value ?? null,
      agedOrders: aged.length,
      agedValue: aged.reduce((s, o) => s + o.totalAmount, 0),
    }

    const anomalies = detectAnomalies(input)
    return NextResponse.json({
      window: { preset: range.preset, label: range.label, from: range.from, to: range.to },
      anomalies,
      inputs: {
        averageShippingFee,
        configuredShippingFee,
        agedOrders: aged.length,
        agedValue: aged.reduce((s, o) => s + o.totalAmount, 0),
      },
    })
  } catch (error) {
    console.error('Anomalies error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to detect anomalies' },
      { status: 500 }
    )
  }
}
