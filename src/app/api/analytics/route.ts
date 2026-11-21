import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildAnalytics } from '@/lib/analytics/engine'

export const dynamic = 'force-dynamic'

/**
 * The finance & analytics payload: profit & loss, cash flow, product
 * economics and the expense breakdown — all for one window, all with their
 * own status.
 *
 * Read-only. Viewer role is enough.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const analytics = await buildAnalytics(supabase, {
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    })

    return NextResponse.json(analytics)
  } catch (error) {
    console.error('Analytics error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the analytics' },
      { status: 500 }
    )
  }
}
