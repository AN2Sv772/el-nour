import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * The question catalogue with the owner's answers.
 *
 * The catalogue itself is code (see `src/lib/brain/questions.ts`); this route
 * joins it with the stored answers so the UI can show "asked / answered /
 * skipped" without duplicating the questions in two places.
 */
export async function GET() {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_brain_questions')
      .select('*')
      .order('area', { ascending: true })

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ available: false, questions: [], answers: {} })
      }
      throw error
    }

    const answers: Record<string, unknown> = {}
    for (const row of data ?? []) {
      answers[row.question_key] = row
    }

    return NextResponse.json({ available: true, answers })
  } catch (error) {
    console.error('Brain questions GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the questions' },
      { status: 500 }
    )
  }
}
