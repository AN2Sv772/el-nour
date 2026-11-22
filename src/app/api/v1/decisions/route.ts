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
    // The raw database error is logged server-side, never returned — an
    // external API caller used to receive the PostgREST message verbatim,
    // which maps the schema and reveals which tables and settings exist.
    const reference = globalThis.crypto?.randomUUID?.() ?? `ref-${Date.now()}`
    console.error(`v1 decisions error [${reference}]:`, error)
    return NextResponse.json(
      { error: 'Failed to read the decisions', reference },
      { status: 500 }
    )
  }
}
