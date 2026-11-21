import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * The knowledge items — what the business knows about itself.
 *
 * GET: viewer.  POST: employee (anybody who works here can record what they
 * know), but an item can only be VERIFIED by an admin — the database CHECK
 * also refuses to verify an item whose source is an AI read.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const params = request.nextUrl.searchParams
    const topic = params.get('topic')
    const status = params.get('status')
    const query = params.get('q')

    let q = supabase
      .from('business_knowledge')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200)

    if (topic) q = q.eq('topic', topic)
    if (status) q = q.eq('status', status)
    if (query) q = q.ilike('title', `%${query}%`)

    const { data, error } = await q
    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ available: false, items: [] })
      }
      throw error
    }

    return NextResponse.json({ available: true, items: data ?? [] })
  } catch (error) {
    console.error('Brain knowledge GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the knowledge' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const title = String(body.title ?? '').trim()
    const text = String(body.body ?? '').trim()

    if (!title || !text) {
      return NextResponse.json({ error: 'العنوان والنص مطلوبان' }, { status: 400 })
    }

    const sourceKind = String(body.source_kind ?? 'owner')
    const allowedSources = ['owner', 'file', 'data', 'decision', 'ai_read', 'chat', 'import']
    if (!allowedSources.includes(sourceKind)) {
      return NextResponse.json({ error: 'مصدر غير معروف' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const insert = {
      topic: String(body.topic ?? 'business_basics'),
      title,
      body: text,
      kind: String(body.kind ?? 'fact'),
      source_kind: sourceKind,
      source_ref: body.source_ref ?? {},
      confidence: body.confidence ?? 0.5,
      status: 'unverified',
      check_in_months: body.check_in_months ?? null,
      effective_until: body.effective_until ?? null,
      created_by: auth.user.id,
    }

    const { data, error } = await supabase.from('business_knowledge').insert(insert).select('*').single()
    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json(
          { error: 'جداول Business Brain غير مطبَّقة بعد.' },
          { status: 503 }
        )
      }
      throw error
    }

    return NextResponse.json({ available: true, item: data }, { status: 201 })
  } catch (error) {
    console.error('Brain knowledge POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save the knowledge' },
      { status: 500 }
    )
  }
}
