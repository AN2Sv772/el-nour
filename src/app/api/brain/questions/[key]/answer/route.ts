import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'
import { BRAIN_QUESTION_BY_KEY } from '@/lib/brain/questions'

export const dynamic = 'force-dynamic'

/**
 * Answer (or skip) one business question.
 *
 * The question key must exist in the catalogue — the endpoint does not accept
 * an arbitrary key, so a typo cannot create a question nobody tracks.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const { key } = await context.params

  try {
    const definition = BRAIN_QUESTION_BY_KEY.get(key)
    if (!definition) {
      return NextResponse.json({ error: 'سؤال غير معروف' }, { status: 404 })
    }

    const body = await request.json()
    const action = String(body.action ?? 'answer')
    const answer = typeof body.answer === 'string' ? body.answer.trim() : ''

    if (action === 'answer' && answer.length === 0) {
      return NextResponse.json({ error: 'الإجابة لا يمكن أن تكون فارغة' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const supabase = createServiceClient()

    const row = {
      question_key: key,
      topic: definition.topic,
      prompt: definition.prompt,
      prompt_ar: definition.prompt_ar,
      why_it_matters: definition.why_it_matters,
      area: definition.area,
      required: definition.required,
      check_in_months: definition.check_in_months ?? null,
      answer: action === 'skip' ? null : answer,
      answer_source: String(body.answer_source ?? 'owner'),
      status: action === 'skip' ? 'skipped' : 'answered',
      answered_by: auth.user.id,
      answered_at: now,
      updated_at: now,
    }

    const { data: existing, error: readError } = await supabase
      .from('business_brain_questions')
      .select('id')
      .eq('question_key', key)
      .maybeSingle()

    if (readError) {
      if (isMissingBrainTables(readError)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      throw readError
    }

    const { data, error } = existing
      ? await supabase.from('business_brain_questions').update(row).eq('id', existing.id).select('*').single()
      : await supabase.from('business_brain_questions').insert(row).select('*').single()

    if (error) throw error

    return NextResponse.json({ available: true, question: data })
  } catch (error) {
    console.error('Brain question answer error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save the answer' },
      { status: 500 }
    )
  }
}
