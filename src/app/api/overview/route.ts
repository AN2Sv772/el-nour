import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { buildAnalytics } from '@/lib/analytics/engine'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { buildBusinessOverviewPage } from '@/lib/overview/engine'
import { buildDecisions } from '@/lib/decisions/engine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/overview — the business cockpit.
 *
 * Six headline numbers, the profit breakdown, the daily trend, the
 * profitability legs and the month-health verdict. Everything is derived from
 * the shared metric engine, so this endpoint can never disagree with the
 * dashboard, the analytics page or the agent.
 *
 * Read-only. Viewer role is enough.
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

    const [analytics, overview] = await Promise.all([
      buildAnalytics(supabase, options),
      buildBusinessOverview(supabase, { ...options, includePrevious: true }),
    ])

    // The main risk comes from the decisions engine — the same rules the
    // /decisions page shows, so the cockpit and the list never disagree.
    let risk: { title: string; detail: string; href: string } | null = null
    try {
      const decisions = await buildDecisions(supabase, { ...options, overview })
      const list = decisions.decisions ?? []
      const worst =
        list.find(d => d.severity === 'critical') ?? list.find(d => d.severity === 'high')
      if (worst) {
        risk = {
          title: worst.title,
          detail: worst.why,
          href: worst.action?.href ?? '/decisions',
        }
      }
    } catch {
      // A missing decisions engine must not break the cockpit.
      risk = null
    }

    const payload = buildBusinessOverviewPage(overview, analytics, { risk })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Overview error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the overview' },
      { status: 500 }
    )
  }
}
