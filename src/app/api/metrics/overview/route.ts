import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildBusinessOverview } from '@/lib/metrics/engine'

export const dynamic = 'force-dynamic'

/**
 * The executive metric set — every number with its own status, calculation,
 * source, window and last-update time.
 *
 * Read-only. The same endpoint feeds the home dashboard, the finance module,
 * the analytics module and the AI agent's tools, so there is exactly ONE
 * definition of every figure in the product.
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

    return NextResponse.json(overview)
  } catch (error) {
    console.error('Metrics overview error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the overview' },
      { status: 500 }
    )
  }
}
