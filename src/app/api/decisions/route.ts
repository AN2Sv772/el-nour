import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildDecisions } from '@/lib/decisions/engine'
import { AD_PLATFORMS, connectedAdPlatforms } from '@/lib/ads/connector'

export const dynamic = 'force-dynamic'

/**
 * The decision list — each decision with its evidence, its severity and the
 * action that resolves it.
 *
 * Read-only. Viewer role is enough.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const result = await buildDecisions(supabase, {
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    })

    return NextResponse.json({
      ...result,
      adPlatforms: {
        connected: connectedAdPlatforms(),
        available: AD_PLATFORMS,
      },
    })
  } catch (error) {
    console.error('Decisions error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the decisions' },
      { status: 500 }
    )
  }
}
