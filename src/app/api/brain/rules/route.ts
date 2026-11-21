import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * The business rules — natural-language rules the AI agent must follow.
 *
 * GET: viewer.  POST/PUT/DELETE: admin.
 */
export async function GET() {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_rules')
      .select('*')
      .order('priority', { ascending: true })

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ available: false, rules: [] })
      }
      throw error
    }

    return NextResponse.json({ available: true, rules: data ?? [] })
  } catch (error) {
    console.error('Brain rules GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the rules' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const title = String(body.title ?? '').trim()
    const text = String(body.body ?? '').trim()

    if (!title || !text) {
      return NextResponse.json({ error: 'عنوان القاعدة ونصها مطلوبان' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_rules')
      .insert({
        title,
        body: text,
        scope: String(body.scope ?? 'general'),
        priority: Number(body.priority ?? 100),
        is_active: body.is_active ?? true,
        effective_from: body.effective_from ?? null,
        effective_until: body.effective_until ?? null,
        source_knowledge_id: body.source_knowledge_id ?? null,
        created_by: auth.user.id,
      })
      .select('*')
      .single()

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      throw error
    }

    return NextResponse.json({ available: true, rule: data }, { status: 201 })
  } catch (error) {
    console.error('Brain rules POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save the rule' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'معرّف القاعدة مطلوب' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    for (const field of ['title', 'body', 'scope', 'priority', 'is_active', 'effective_from', 'effective_until']) {
      if (body[field] !== undefined) patch[field] = body[field]
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_rules')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'القاعدة غير موجودة' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ available: true, rule: data })
  } catch (error) {
    console.error('Brain rules PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update the rule' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'معرّف القاعدة مطلوب' }, { status: 400 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('business_rules').delete().eq('id', id)
    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      throw error
    }

    return NextResponse.json({ available: true, deleted: id })
  } catch (error) {
    console.error('Brain rules DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete the rule' },
      { status: 500 }
    )
  }
}
