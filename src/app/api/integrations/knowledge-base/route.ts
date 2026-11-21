import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * GET /api/integrations/knowledge-base
 */
export async function GET() {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('*')
      .order('priority', { ascending: false })

    if (error) throw error
    return NextResponse.json({ entries: data || [] })
  } catch (error) {
    console.error('GET knowledge base error:', error)
    return NextResponse.json({ error: 'فشل تحميل قاعدة المعرفة' }, { status: 500 })
  }
}

/**
 * POST /api/integrations/knowledge-base
 */
export async function POST(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { category, question, answer, keywords, priority, is_active } = body

    if (!answer) {
      return NextResponse.json({ error: 'حقل "answer" مطلوب' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('knowledge_base')
      .insert({
        category: category || 'faq',
        question: question || null,
        answer,
        keywords: Array.isArray(keywords) ? keywords : [],
        priority: priority || 0,
        is_active: is_active ?? true,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, entry: data })
  } catch (error) {
    console.error('POST knowledge base error:', error)
    return NextResponse.json({ error: 'فشل إضافة الإدخال' }, { status: 500 })
  }
}

/**
 * PUT /api/integrations/knowledge-base
 */
export async function PUT(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { id, category, question, answer, keywords, priority, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'حقل "id" مطلوب' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (category !== undefined) updateData.category = category
    if (question !== undefined) updateData.question = question
    if (answer !== undefined) updateData.answer = answer
    if (keywords !== undefined) updateData.keywords = Array.isArray(keywords) ? keywords : []
    if (priority !== undefined) updateData.priority = priority
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from('knowledge_base')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, entry: data })
  } catch (error) {
    console.error('PUT knowledge base error:', error)
    return NextResponse.json({ error: 'فشل تحديث الإدخال' }, { status: 500 })
  }
}

/**
 * DELETE /api/integrations/knowledge-base?id=xxx
 */
export async function DELETE(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'معرّف "id" مطلوب' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Deleting zero rows is not a success: an unknown id is a 404, so the
    // caller can tell "already gone" from "deleted now".
    const { data: existing, error: lookupError } = await supabase
      .from('knowledge_base')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) {
      return NextResponse.json({ error: 'الإدخال غير موجود' }, { status: 404 })
    }

    const { error } = await supabase.from('knowledge_base').delete().eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE knowledge base error:', error)
    return NextResponse.json({ error: 'فشل حذف الإدخال' }, { status: 500 })
  }
}
