import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import {
  captureBeforeState,
  executeApproval,
  reverseApproval,
  type ApprovalRow,
} from '@/lib/ai/approvals'

export const dynamic = 'force-dynamic'

/**
 * Approve, reject, or undo one proposal.
 *
 * ADMIN ONLY — this is the owner's signature.
 *
 * The execution is exactly-once: the approval must be `approved` (not
 * rejected, not expired, not already executed), and the execution log's
 * UNIQUE idempotency key is the final guard.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  try {
    const body = await request.json()
    const action = String(body.action ?? 'approve')

    const supabase = createServiceClient()
    const { data: approval, error } = await supabase
      .from('ai_approvals')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 503 })
    if (!approval) return NextResponse.json({ error: 'الاقتراح غير موجود' }, { status: 404 })

    const row = approval as unknown as ApprovalRow

    /* ── Reject ──────────────────────────────────────────────────────── */
    if (action === 'reject') {
      if (row.status !== 'pending') {
        return NextResponse.json(
          { error: `لا يمكن رفض اقتراح حالته "${row.status}"` },
          { status: 409 }
        )
      }
      const { data, error: updateError } = await supabase
        .from('ai_approvals')
        .update({ status: 'rejected', rejected_by: auth.user.id, approved_at: null })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .single()

      if (updateError) throw updateError
      return NextResponse.json({ available: true, approval: data })
    }

    /* ── Undo ────────────────────────────────────────────────────────── */
    if (action === 'undo') {
      if (row.status !== 'done') {
        return NextResponse.json(
          { error: 'التراجع متاح فقط بعد تنفيذ الاقتراح' },
          { status: 409 }
        )
      }
      const result = await reverseApproval(supabase, row, auth.user.id)
      if (!result.ok) {
        return NextResponse.json({ error: result.error ?? 'تعذّر التراجع' }, { status: 400 })
      }
      const { data } = await supabase
        .from('ai_approvals')
        .update({ status: 'approved', executed_at: null, error: null })
        .eq('id', id)
        .select('*')
        .single()
      return NextResponse.json({ available: true, approval: data, undone: true })
    }

    /* ── Approve + execute ───────────────────────────────────────────── */
    if (action !== 'approve') {
      return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
    }

    if (row.status === 'done') {
      return NextResponse.json(
        { error: 'نُفِّذ هذا الاقتراح بالفعل — لم يتكرر.' },
        { status: 409 }
      )
    }
    if (row.status === 'rejected') {
      return NextResponse.json({ error: 'هذا الاقتراح مرفوض' }, { status: 409 })
    }
    if (row.status !== 'pending' && row.status !== 'approved') {
      return NextResponse.json({ error: `لا يمكن الموافقة على حالة "${row.status}"` }, { status: 409 })
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      await supabase.from('ai_approvals').update({ status: 'expired' }).eq('id', id)
      return NextResponse.json({ error: 'انتهت صلاحية هذا الاقتراح' }, { status: 409 })
    }

    // The before-state is captured at APPROVAL time, so the log shows what
    // really changed — not what was true when the proposal was written.
    const beforeState = row.before_state ?? (await captureBeforeState(supabase, {
      type: row.action_type,
      title: row.title,
      description: row.description,
      payload: row.payload,
      impactSummary: row.impact_summary ?? '',
      riskLevel: row.risk_level,
      reversible: row.reversible,
    }))

    const { error: approveError } = await supabase
      .from('ai_approvals')
      .update({
        status: 'approved',
        approved_by: auth.user.id,
        approved_at: new Date().toISOString(),
        before_state: beforeState,
      })
      .eq('id', id)
      .in('status', ['pending', 'approved'])

    if (approveError) throw approveError

    const { data: approvedRow } = await supabase
      .from('ai_approvals')
      .select('*')
      .eq('id', id)
      .single()

    const result = await executeApproval(
      supabase,
      approvedRow as unknown as ApprovalRow,
      auth.user.id
    )

    if (!result.ok) {
      const { data: failed } = await supabase
        .from('ai_approvals')
        .update({ status: 'failed', error: result.error ?? 'Unknown error' })
        .eq('id', id)
        .select('*')
        .single()
      return NextResponse.json(
        { available: true, approval: failed, error: result.error ?? 'فشل التنفيذ' },
        { status: 400 }
      )
    }

    const { data: done } = await supabase
      .from('ai_approvals')
      .update({
        status: 'done',
        executed_at: new Date().toISOString(),
        after_state: result.afterState ?? null,
      })
      .eq('id', id)
      .select('*')
      .single()

    return NextResponse.json({ available: true, approval: done })
  } catch (error) {
    console.error('Approval action error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process the approval' },
      { status: 500 }
    )
  }
}
