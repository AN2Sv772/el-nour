import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyApiKey } from '@/lib/api/api-key'
import { buildDecisions } from '@/lib/decisions/engine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/decisions
 *
 * The decisions the owner should act on, each with its evidence. Read-only.
 */
export async function GET(request: NextRequest) {
  const auth = verifyApiKey(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const result = await buildDecisions(supabase, {
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    })

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  } catch (error) {
    console.error('v1 decisions error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the decisions' },
      { status: 500 }
    )
  }
}
