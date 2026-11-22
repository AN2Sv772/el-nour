import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * Edit or forget one knowledge item.
 *
 * PATCH: employee.  DELETE: manager — and it does NOT delete the row: it
 * marks the item `forgotten`, so the history of what the business used to
 * believe stays auditable.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  try {
    const body = await request.json()
    const patch: Record<string, unknown> = {}

    for (const field of ['topic', 'title', 'body', 'kind', 'confidence', 'check_in_months', 'effective_until', 'last_checked_at']) {
      if (body[field] !== undefined) patch[field] = body[field]
    }

    // Verification is an admin act, and never for an AI-sourced item.
    if (body.status !== undefined) {
      if (body.status === 'verified' && auth.role !== 'admin') {
        return NextResponse.json(
          { error: 'تأكيد المعلومة يتطلب صلاحية مدير عام' },
          { status: 403 }
        )
      }
      // Forgetting is a MANAGER act — the DELETE handler is the forget path,
      // and it keeps the audit trail. Letting PATCH set `forgotten` would let
      // any employee silently drop a fact (including an admin-verified one)
      // out of the business knowledge the assistant answers from.
      if (
        body.status === 'forgotten' &&
        auth.role !== 'manager' &&
        auth.role !== 'admin'
      ) {
        return NextResponse.json(
          { error: 'نسيان المعلومة يتطلب صلاحية مدير' },
          { status: 403 }
        )
      }
      patch.status = body.status
      if (body.status === 'verified') {
        patch.verified_by = auth.user.id
        patch.verified_at = new Date().toISOString()
        patch.last_checked_at = new Date().toISOString()
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'لا توجد حقول للتعديل' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_knowledge')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'العنصر غير موجود' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ available: true, item: data })
  } catch (error) {
    console.error('Brain knowledge PATCH error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update the knowledge' },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_knowledge')
      .update({ status: 'forgotten', last_checked_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      throw error
    }

    return NextResponse.json({ available: true, forgotten: data })
  } catch (error) {
    console.error('Brain knowledge DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to forget the knowledge' },
      { status: 500 }
    )
  }
}
