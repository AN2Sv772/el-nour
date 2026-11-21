import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { computeBrainStatus, readBrainRows, BRAIN_STATUS_LABEL, BRAIN_STATUS_DESCRIPTION } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * The Brain's status: how much of the business is actually known, what is
 * missing, and what needs the owner's attention.
 *
 * If the Brain tables are not in the database yet, the answer is an explicit
 * `not_configured` — never a crash and never a fake number.
 */
export async function GET() {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const rows = await readBrainRows(supabase)

    if (!rows) {
      return NextResponse.json({
        available: false,
        status: 'not_configured',
        statusLabel: BRAIN_STATUS_LABEL.not_configured,
        statusDescription:
          'جداول Business Brain غير مطبَّقة على قاعدة البيانات بعد. شغّل migration 20260123000000_business_brain.sql.',
        coverage: 0,
        answered: 0,
        answerable: 0,
        total: 0,
        openRequired: 0,
        skippedRequired: 0,
        knowledge: {
          total: 0,
          verified: 0,
          unverified: 0,
          conflicted: 0,
          outdated: 0,
          forgotten: 0,
        },
        gaps: [],
        areas: [],
        lastRun: null,
      })
    }

    const report = computeBrainStatus({
      profile: rows.profile,
      questions: rows.questions,
      knowledge: rows.knowledge,
      lastRun: rows.lastRun,
    })

    return NextResponse.json({ available: true, ...report })
  } catch (error) {
    console.error('Brain status error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the Brain status' },
      { status: 500 }
    )
  }
}
