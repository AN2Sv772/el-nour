import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { runBrainAudit } from '@/lib/brain/audit'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * Run the business audit: coverage, gaps, and data completeness.
 *
 * Admin only — it writes a `business_brain_runs` row so the history of
 * "what did the audit find, and when" is kept.
 */
export async function POST() {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const report = await runBrainAudit(supabase)

    if (!report) {
      return NextResponse.json(
        {
          available: false,
          error:
            'جداول Business Brain غير مطبَّقة بعد. شغّل migration 20260123000000_business_brain.sql أولاً.',
        },
        { status: 503 }
      )
    }

    // Keep the run — the audit history is part of the audit trail.
    const { error: runError } = await supabase.from('business_brain_runs').insert({
      status: 'succeeded',
      step: 'report',
      areas_learned: report.findings.map(f => f.area),
      facts_kept: report.answered,
      answers_dropped: 0,
      coverage_before: report.coverage,
      coverage_after: report.coverage,
      report: report as unknown as Record<string, unknown>,
      started_by: auth.user.id,
      finished_at: new Date().toISOString(),
    })
    if (runError && !isMissingBrainTables(runError)) {
      // The report is still valid — the history write is best-effort.
      console.error('Brain audit run insert failed:', runError.message)
    }

    return NextResponse.json({ available: true, report })
  } catch (error) {
    console.error('Brain audit error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run the audit' },
      { status: 500 }
    )
  }
}
