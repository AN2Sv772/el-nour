import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildAnalytics } from '@/lib/analytics/engine'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { csvResponse, type CsvColumn } from '@/lib/api/csv'
import { parseDateParam } from '@/lib/api-params'
import { businessDateString, BUSINESS_TIME_ZONE } from '@/lib/date-range'
import { formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/financial?dateRange=|from=&to=&format=csv&export=daily|products
 *
 * THE FINANCIAL REPORT — and it is built on the honest engines.
 *
 * WHY THIS ENDPOINT WAS REBUILT
 *
 * The old version computed `provisional_profit = sales − cogs − expenses`
 * with cogs = 0 (no product had a recorded cost) and expenses = 0 (the
 * expenses table was empty). On the live store that printed a bold
 * "الربح الأولي: 323,445 E£" — a number that was simply the SALES, wearing
 * a profit's label. It also ignored the shared date engine, so its window
 * silently differed from the dashboard's.
 *
 * Now the report is the SAME statement the analytics page shows: every line
 * carries its status, the profit is withheld while its inputs are missing,
 * and the window comes from the one date engine the whole app uses.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const fromParam = parseDateParam(params.get('from'), 'تاريخ البداية')
    if (!fromParam.ok) return NextResponse.json({ error: fromParam.error }, { status: 400 })
    const toParam = parseDateParam(params.get('to'), 'تاريخ النهاية')
    if (!toParam.ok) return NextResponse.json({ error: toParam.error }, { status: 400 })

    const analytics = await buildAnalytics(supabase, {
      dateRange: params.get('dateRange'),
      from: fromParam.value,
      to: toParam.value,
    })

    // The daily series is read with DATE-ONLY bounds. The resolved window is
    // a pair of UTC instants (a Cairo day starts at 22:00 UTC the day
    // before), and handing those to the custom-range parser would be
    // rejected as invalid dates — which silently falls back to "all time".
    const fromDay =
      fromParam.value ??
      (analytics.window.from
        ? businessDateString(new Date(analytics.window.from), BUSINESS_TIME_ZONE)
        : null)
    const toDay =
      toParam.value ??
      (analytics.window.to
        ? businessDateString(new Date(analytics.window.to), BUSINESS_TIME_ZONE)
        : null)

    /* ── CSV export ──────────────────────────────────────────────────── */
    const format = params.get('format')
    const exportWhat = params.get('export') ?? 'daily'

    if (format === 'csv') {
      const stamp = `${analytics.window.from?.slice(0, 10) ?? 'all'}_${analytics.window.to?.slice(0, 10) ?? 'now'}`

      if (exportWhat === 'products') {
        const columns: CsvColumn<typeof analytics.productEconomics.products[number]>[] = [
          { key: 'name', header: 'المنتج', value: p => p.name },
          { key: 'sku', header: 'SKU', value: p => p.sku ?? '' },
          { key: 'units', header: 'الوحدات', value: p => p.units },
          { key: 'revenue', header: 'المبيعات', value: p => p.revenue },
          { key: 'share', header: 'نسبة المبيعات %', value: p => p.revenueShare ?? '' },
          { key: 'cost', header: 'التكلفة', value: p => (p.margin === null ? '' : p.cost) },
          { key: 'margin', header: 'الهامش', value: p => (p.margin === null ? '' : p.margin) },
          { key: 'marginPercent', header: 'الهامش %', value: p => p.marginPercent ?? '' },
          { key: 'status', header: 'الحالة', value: p => p.status },
        ]
        return csvResponse(analytics.productEconomics.products, columns, `products_${stamp}.csv`)
      }

      const daily = fromDay ? await dailySeries(supabase, fromDay, toDay) : []

      const columns: CsvColumn<(typeof daily)[number]>[] = [
        { key: 'date', header: 'التاريخ', value: d => d.date },
        { key: 'orders', header: 'الطلبات', value: d => d.orders },
        { key: 'revenue', header: 'المبيعات', value: d => d.revenue },
        { key: 'cost', header: 'تكلفة المنتجات', value: d => (d.profit === null ? '' : d.cost) },
        { key: 'expenses', header: 'المصروفات', value: d => d.expenses },
        { key: 'profit', header: 'الربح', value: d => (d.profit === null ? '' : d.profit) },
      ]
      return csvResponse(daily, columns, `daily_${stamp}.csv`)
    }

    /* ── JSON ────────────────────────────────────────────────────────── */
    const daily = fromDay ? await dailySeries(supabase, fromDay, toDay) : []

    return NextResponse.json({
      window: analytics.window,
      statement: analytics.profitAndLoss,
      daily,
      productEconomics: analytics.productEconomics,
      cashFlow: analytics.cashFlow,
      expensesByCategory: analytics.expensesByCategory,
      expensesNotRecorded: analytics.expensesNotRecorded,
      previous: analytics.previous,
    })
  } catch (error) {
    console.error('GET financial report error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'فشل توليد التقرير المالي' },
      { status: 500 }
    )
  }
}

/**
 * The daily series for the report — the SAME series the dashboard chart
 * uses, so the two can never disagree.
 */
async function dailySeries(
  db: ReturnType<typeof createServiceClient>,
  from: string,
  to: string | null
) {
  // `from` / `to` are YYYY-MM-DD business days.
  const overview = await buildBusinessOverview(db, {
    dateRange: 'custom',
    from,
    to,
    includePrevious: false,
  })
  return overview.series
}

/** Used by the page to show the orders count next to the sales. */
export function ordersOf(series: { orders: number }[]): number {
  return series.reduce((s, d) => s + d.orders, 0)
}

export { formatNumber }
