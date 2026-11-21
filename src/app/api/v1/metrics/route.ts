import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyApiKey } from '@/lib/api/api-key'
import { buildBusinessOverview } from '@/lib/metrics/engine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/metrics?dateRange=last_30_days
 *
 * The READ-ONLY external API. Every number carries its status, its
 * calculation and its sources — the same payload the dashboard uses, so an
 * external tool can never quote a number the owner cannot check.
 *
 * Auth: `x-api-key` (or `Authorization: Bearer …`).
 */
export async function GET(request: NextRequest) {
  const auth = verifyApiKey(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams

    const overview = await buildBusinessOverview(supabase, {
      dateRange: params.get('dateRange'),
      from: params.get('from'),
      to: params.get('to'),
    })

    return NextResponse.json(
      {
        window: overview.window,
        metrics: overview.metrics.map(m => ({
          key: m.key,
          label: m.label,
          value: m.value,
          unit: m.unit,
          status: m.provenance.status,
          calculation: m.provenance.calculation,
          source: m.provenance.source,
          missing: m.provenance.missing,
        })),
        alerts: overview.alerts,
        gaps: overview.gaps,
        series: overview.series,
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  } catch (error) {
    console.error('v1 metrics error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the metrics' },
      { status: 500 }
    )
  }
}
