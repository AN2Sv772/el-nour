import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isAllowedAction, idempotencyKeyFor, type ApprovalAction } from '@/lib/ai/approvals'
import { isMissingTableError, missingTableResponse } from '@/lib/api/missing-table'

export const dynamic = 'force-dynamic'

/**
 * The proposals waiting for the owner.
 *
 * GET: viewer.  POST: employee (anybody who works here may PROPOSE; only an
 * admin can approve).
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const status = request.nextUrl.searchParams.get('status')

    let query = supabase
      .from('ai_approvals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      // The table is not applied yet — say which file is missing.
      if (isMissingTableError(error.message)) {
        return missingTableResponse(error.message, '20260124000000_ai_approvals.sql', 'ai_approvals')
      }
      return NextResponse.json({ available: false, approvals: [], error: error.message }, { status: 503 })
    }

    return NextResponse.json({ available: true, approvals: data ?? [] })
  } catch (error) {
    console.error('Approvals GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the approvals' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const type = String(body.action_type ?? '')

    if (!isAllowedAction(type)) {
      return NextResponse.json(
        { error: `الإجراء غير مسموح. المسموح: ${['set_product_cost', 'add_expense', 'set_business_setting'].join('، ')}` },
        { status: 400 }
      )
    }

    const action: ApprovalAction = {
      type,
      title: String(body.title ?? '').trim(),
      description: String(body.description ?? '').trim(),
      payload: body.payload ?? {},
      impactSummary: String(body.impact_summary ?? '').trim(),
      riskLevel: (body.risk_level ?? 'low') as ApprovalAction['riskLevel'],
      reversible: body.reversible ?? true,
    }

    if (!action.title || !action.description) {
      return NextResponse.json({ error: 'عنوان الإجراء ووصفه مطلوبان' }, { status: 400 })
    }

    const key = idempotencyKeyFor(action)

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ai_approvals')
      .insert({
        action_type: action.type,
        title: action.title,
        description: action.description,
        payload: action.payload,
        impact_summary: action.impactSummary || null,
        risk_level: action.riskLevel,
        reversible: action.reversible,
        status: 'pending',
        idempotency_key: key,
        requested_by: auth.user.id,
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'هذا الإجراء مقترح بالفعل وبانتظار الموافقة.' },
          { status: 409 }
        )
      }
      if (isMissingTableError(error.message)) {
        return missingTableResponse(error.message, '20260124000000_ai_approvals.sql', 'ai_approvals')
      }
      return NextResponse.json({ error: error.message }, { status: 503 })
    }

    return NextResponse.json({ available: true, approval: data }, { status: 201 })
  } catch (error) {
    console.error('Approvals POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create the approval' },
      { status: 500 }
    )
  }
}
