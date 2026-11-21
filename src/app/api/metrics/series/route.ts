import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'

export const dynamic = 'force-dynamic'

/**
 * The daily revenue / cost / profit series for the window.
 *
 * A day whose cost is unknown carries revenue but no profit — the point on the
 * chart is absent rather than zero, so a gap never reads as "no profit".
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
      series: overview.series,
    })
  } catch (error) {
    console.error('Metrics series error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the series' },
      { status: 500 }
    )
  }
}
