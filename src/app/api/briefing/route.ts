import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { buildDecisions } from '@/lib/decisions/engine'
import { fetchOrdersWithCustomers, resolveWindow, cairoDay } from '@/lib/intelligence/server'
import { detectAnomalies, type AnomalyInput } from '@/lib/intelligence/anomaly'
import { buildBriefing } from '@/lib/intelligence/briefing'

export const dynamic = 'force-dynamic'

/**
 * GET /api/briefing — the daily business briefing.
 *
 * Every line is backed by a real number; every action is a task for a human,
 * never an automatic execution.
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

    // The three reads run together — the briefing is opened at 9 AM and must
    // not make the owner wait for three sequential round trips.
    const [overview, today, orders] = await Promise.all([
      buildBusinessOverview(supabase, options),
      buildBusinessOverview(supabase, { dateRange: 'today' }),
      fetchOrdersWithCustomers(supabase, range.from, range.to, { limit: 5000 }),
    ])

    const fees = (orders as any[]).map(o => Number(o.shipping_fee ?? 0)).filter(f => f > 0)
    const averageShippingFee = fees.length > 0 ? fees.reduce((s, f) => s + f, 0) / fees.length : null
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
    const revenue = overview.byKey.revenue?.value ?? 0
    const topProductShare =
      revenue > 0 && overview.topProducts.length > 0 ? overview.topProducts[0].revenue / revenue : null

    const anomalyInput: AnomalyInput = {
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
    const anomalies = detectAnomalies(anomalyInput)

    let decisions: Awaited<ReturnType<typeof buildDecisions>> | null = null
    try {
      decisions = await buildDecisions(supabase, { ...options, overview })
    } catch {
      decisions = null
    }

    const missing: { label: string; reason: string; href?: string }[] = []
    if (overview.byKey.product_costs?.provenance.status !== 'actual') {
      missing.push({
        label: 'تكلفة المنتجات',
        reason: 'المنتجات بدون تكلفة شراء تحجب مجمل الربح',
        href: '/setup/costs',
      })
    }
    if (overview.byKey.operating_expenses?.provenance.status !== 'actual') {
      missing.push({
        label: 'المصروفات التشغيلية',
        reason: 'لا تُسجَّل مصروفات في النظام',
        href: '/reports',
      })
    }
    if (overview.byKey.advertising_spend?.provenance.status !== 'actual') {
      missing.push({
        label: 'مصروف الإعلانات',
        reason: 'لا يوجد اتصال بإعلانات مدفوعة',
        href: '/marketing',
      })
    }
    if (overview.byKey.cash_collected?.provenance.status !== 'actual') {
      missing.push({
        label: 'دفعات التحصيل',
        reason: 'لا توجد دفعات تحصيل مسجّلة',
        href: '/collections',
      })
    }

    const briefing = buildBriefing({
      date: cairoDay(new Date()),
      today: {
        orders: today.byKey.total_orders?.value ?? 0,
        revenue: today.byKey.revenue?.value ?? null,
        delivered: today.byKey.delivered_orders?.value ?? 0,
        profit: today.byKey.net_profit?.value ?? null,
      },
      period: {
        label: range.label,
        revenue: overview.byKey.revenue?.value ?? null,
        orders: overview.byKey.total_orders?.value ?? 0,
        profit: overview.byKey.net_profit?.value ?? null,
      },
      risks: (decisions?.decisions ?? []).map(d => ({
        id: d.id,
        severity: d.severity,
        title: d.title,
        why: d.why,
        href: d.action?.href,
      })),
      anomalies: anomalies.map(a => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        what: a.what,
        href: a.href,
      })),
      missing,
    })

    return NextResponse.json(briefing)
  } catch (error) {
    console.error('Briefing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the briefing' },
      { status: 500 }
    )
  }
}
