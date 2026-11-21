import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { parseDateParam } from '@/lib/api-params'

/**
 * GET  /api/expenses?dateFrom=&dateTo=&category=
 * POST /api/expenses  { category, amount, expense_date, notes }
 * PUT  /api/expenses?id=  { category?, amount?, expense_date?, notes? }
 * DELETE /api/expenses?id=  → soft-void (audit preserved, never hard-delete)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const sp = request.nextUrl.searchParams

    let query = supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })

    // Postgres answers 22007 ("invalid input syntax for type date") for a
    // malformed date, which surfaced as an HTTP 500. Validate first.
    const dateFrom = parseDateParam(sp.get('dateFrom'), 'تاريخ البداية')
    if (!dateFrom.ok) {
      return NextResponse.json({ error: dateFrom.error }, { status: 400 })
    }
    const dateTo = parseDateParam(sp.get('dateTo'), 'تاريخ النهاية')
    if (!dateTo.ok) {
      return NextResponse.json({ error: dateTo.error }, { status: 400 })
    }
    const category = sp.get('category')
    if (dateFrom.value) query = query.gte('expense_date', dateFrom.value)
    if (dateTo.value) query = query.lte('expense_date', dateTo.value)
    if (category && category !== 'all') query = query.eq('category', category)

    const { data, error } = await query.limit(500)
    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    console.error('GET expenses error:', error)
    return NextResponse.json({ error: 'فشل تحميل المصروفات' }, { status: 500 })
  }
}

const CATEGORIES = ['shipping', 'packaging', 'advertising', 'other']

export async function POST(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { category, amount, expense_date, notes } = body

    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'تصنيف المصروف غير صحيح' }, { status: 400 })
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً موجباً' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        category,
        amount: amt,
        expense_date: expense_date || new Date().toISOString().slice(0, 10),
        notes: notes || null,
        created_by: auth.user.id,
      })
      .select()
      .single()

    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'expense_created',
      entity_type: 'expenses',
      entity_id: data.id,
      new_value: { category, amount: amt, expense_date: data.expense_date },
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('POST expenses error:', error)
    return NextResponse.json({ error: 'فشل إضافة المصروف' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'معرف المصروف مطلوب' }, { status: 400 })

    const body = await request.json()
    const update: Record<string, unknown> = {}
    if (body.category && CATEGORIES.includes(body.category)) update.category = body.category
    if (body.amount !== undefined) {
      const amt = Number(body.amount)
      if (!Number.isFinite(amt) || amt < 0) {
        return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً موجباً' }, { status: 400 })
      }
      update.amount = amt
    }
    if (body.expense_date) update.expense_date = body.expense_date
    if (body.notes !== undefined) update.notes = body.notes || null

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'لا يوجد تغيير' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: before } = await supabase.from('expenses').select('*').eq('id', id).maybeSingle()
    if (!before) return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 })

    const { data, error } = await supabase
      .from('expenses')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'expense_updated',
      entity_type: 'expenses',
      entity_id: id,
      old_value: { category: before.category, amount: before.amount, expense_date: before.expense_date },
      new_value: update,
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('PUT expenses error:', error)
    return NextResponse.json({ error: 'فشل تعديل المصروف' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'معرف المصروف مطلوب' }, { status: 400 })

    const supabase = createServiceClient()
    // Soft-void: amount zeroed in reports via voided_at, record preserved
    const { data: existing, error: lookupError } = await supabase
      .from('expenses')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) {
      return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 })
    }

    const { error } = await supabase
      .from('expenses')
      .update({ voided_at: new Date().toISOString(), voided_by: auth.user.id })
      .eq('id', id)

    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'expense_voided',
      entity_type: 'expenses',
      entity_id: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE expenses error:', error)
    return NextResponse.json({ error: 'فشل حذف المصروف' }, { status: 500 })
  }
}
