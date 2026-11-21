import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'

export const dynamic = 'force-dynamic'

/**
 * Product performance for the window.
 *
 * A product with an unknown cost keeps its sales and its revenue, and its
 * margin stays null — the list never invents a profit number.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const overview = await buildBusinessOverview(supabase, {
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    })

    return NextResponse.json({
      window: overview.window,
      /** EVERY product that sold in the window (the cost-entry screen needs all). */
      products: overview.products,
      /** The same list ordered by revenue, for the "best sellers" views. */
      topProducts: overview.topProducts,
      losingProducts: overview.losingProducts,
    })
  } catch (error) {
    console.error('Metrics products error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build product performance' },
      { status: 500 }
    )
  }
}
