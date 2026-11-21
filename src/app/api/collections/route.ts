import { NextRequest, NextResponse } from 'next/server'
import { fetchAllByIds, fetchAllRows } from '@/lib/supabase/paginate'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { computeCollectionBatch, round2 } from '@/lib/finance'

/**
 * GET  /api/collections                       → batches + totals
 * GET  /api/collections?eligibleOrders=1&dateFrom=&dateTo= → unallocated orders
 * POST /api/collections                       → create batch (with allocations + deductions)
 * PUT  /api/collections?id=                   → edit received/notes/close (audit)
 * DELETE /api/collections?id=                 → void batch (audit)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const sp = request.nextUrl.searchParams

    // Eligible orders picker: delivered-ish, in range, NOT already allocated
    if (sp.get('eligibleOrders')) {
      const dateFrom = sp.get('dateFrom')
      const dateTo = sp.get('dateTo')
      let q = supabase
        .from('orders')
        .select('id, order_number, total_amount, status, created_at')
        .not('status', 'in', '(cancelled,returned)')
        .order('created_at', { ascending: false })
        .limit(300)
      if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`)
      if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59.999`)

      const { data: orders, error } = await q
      if (error) throw error

      // Paginated: PostgREST returns at most 1000 rows per response. A
      // truncated allocation list would hide already-allocated orders and
      // allow the same order to be counted in two collection batches.
      const allocations = await fetchAllRows<{ order_id: string }>((from, to) =>
        supabase
          .from('collection_allocations')
          .select('order_id')
          .order('id', { ascending: true })
          .range(from, to)
      )
      const allocated = new Set(allocations.map(a => a.order_id))

      return NextResponse.json({
        data: (orders || [])
          .filter(o => !allocated.has(o.id))
          .map(o => ({
            id: o.id,
            order_number: o.order_number,
            total_amount: o.total_amount,
            status: o.status,
            created_at: o.created_at,
          })),
      })
    }

    // Batches with their deductions/allocations
    const { data: batches, error } = await supabase
      .from('collection_batches')
      .select(`
        *,
        deductions:collection_deductions(*),
        allocations:collection_allocations(order_id, allocated_amount, orders(order_number, total_amount, status))
      `)
      .order('transfer_date', { ascending: false })
      .limit(100)
    if (error) throw error

    // Totals
    let totalReceived = 0
    let totalExpected = 0
    let matched = 0
    let unmatched = 0
    for (const b of batches || []) {
      const calc = computeCollectionBatch(
        (b.allocations || []).map((a: { orders: { total_amount: number; status: string } | null; allocated_amount?: number }) => ({
          total_amount: a.orders?.total_amount ?? a.allocated_amount ?? 0,
          status: a.orders?.status ?? 'delivered',
        })),
        b.deductions || [],
        b.received_amount
      )
      totalReceived += calc.received_amount
      totalExpected += calc.expected_amount
      if (calc.is_matched) matched++
      else unmatched++
    }

    return NextResponse.json({
      data: batches || [],
      totals: {
        batches: (batches || []).length,
        matched,
        unmatched,
        total_received: round2(totalReceived),
        total_expected: round2(totalExpected),
        outstanding: round2(totalExpected - totalReceived),
      },
    })
  } catch (error) {
    console.error('GET collections error:', error)
    return NextResponse.json({ error: 'فشل تحميل التحصيلات' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { company_name, batch_reference, transfer_date, orders_date_from, orders_date_to, order_ids, deductions, received_amount, notes } = body

    if (!company_name || !String(company_name).trim()) {
      return NextResponse.json({ error: 'اسم شركة الشحن مطلوب' }, { status: 400 })
    }
    const received = Math.max(0, Number(received_amount) || 0)
    const ids: string[] = Array.isArray(order_ids) ? [...new Set(order_ids)] : []
    const deductionRows = (Array.isArray(deductions) ? deductions : [])
      .filter((d: { label?: string; amount?: number }) => d.label && Number(d.amount) > 0)
      .map((d: { label: string; amount: number }) => ({ label: String(d.label).slice(0, 160), amount: Number(d.amount) }))

    const supabase = createServiceClient()

    // Fetch allocated orders and compute expected server-side (source of truth)
    let orders: { id: string; total_amount: number; status: string }[] = []
    if (ids.length > 0) {
      // The id list is chunked AND paged: an unchunked `in=()` over a large
      // selection produced a request URL past the 16 KB header limit
      // (UND_ERR_HEADERS_OVERFLOW).
      orders = await fetchAllByIds<{ id: string; total_amount: number; status: string }>(
        (chunkIds) => (from, to) =>
          supabase.from('orders').select('id, total_amount, status').in('id', chunkIds)
            .order('id', { ascending: true }).range(from, to),
        ids
      )

      // Duplicate-allocation prevention (DB also enforces UNIQUE(order_id))
      const existing = await fetchAllByIds<{ order_id: string; batch_id: string }>(
        (chunkIds) => (from, to) =>
          supabase.from('collection_allocations').select('order_id, batch_id').in('order_id', chunkIds)
            .order('id', { ascending: true }).range(from, to),
        ids
      )
      if (existing.length > 0) {
        return NextResponse.json(
          { error: `بعض الطلبات مخصصة بالفعل لدفعة سابقة (${existing.length}) — لا يمكن عدّها مرتين` },
          { status: 409 }
        )
      }
    }

    const calc = computeCollectionBatch(orders, deductionRows, received)

    const { data: batch, error: bErr } = await supabase
      .from('collection_batches')
      .insert({
        company_name: String(company_name).trim().slice(0, 120),
        batch_reference: batch_reference ? String(batch_reference).slice(0, 120) : null,
        transfer_date: transfer_date || new Date().toISOString().slice(0, 10),
        orders_date_from: orders_date_from || null,
        orders_date_to: orders_date_to || null,
        expected_amount: calc.expected_amount,
        received_amount: received,
        status: calc.is_matched ? 'matched' : 'open',
        notes: notes || null,
        created_by: auth.user.id,
      })
      .select()
      .single()
    if (bErr) throw bErr

    if (deductionRows.length > 0) {
      const { error: dErr } = await supabase
        .from('collection_deductions')
        .insert(deductionRows.map(d => ({ batch_id: batch.id, ...d })))
      if (dErr) throw dErr
    }

    if (ids.length > 0) {
      const { error: aErr } = await supabase
        .from('collection_allocations')
        .insert(
          orders.map(o => ({
            batch_id: batch.id,
            order_id: o.id,
            allocated_amount: o.total_amount,
          }))
        )
      if (aErr) throw aErr
    }

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'collection_batch_created',
      entity_type: 'collection_batches',
      entity_id: batch.id,
      new_value: {
        company_name: batch.company_name,
        orders: ids.length,
        expected: calc.expected_amount,
        received,
        deductions: deductionRows.length,
      },
    })

    return NextResponse.json({ success: true, data: batch, calculation: calc })
  } catch (error) {
    console.error('POST collections error:', error)
    const msg = error instanceof Error ? error.message : ''
    return NextResponse.json(
      { error: msg.includes('duplicate') ? 'دفعة مكررة أو طلب مخصص مسبقًا' : `فشل إنشاء الدفعة: ${msg}` },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'المعرف مطلوب' }, { status: 400 })

    const body = await request.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.received_amount !== undefined) update.received_amount = Math.max(0, Number(body.received_amount) || 0)
    if (body.notes !== undefined) update.notes = body.notes
    if (body.batch_reference !== undefined) update.batch_reference = body.batch_reference

    const supabase = createServiceClient()

    const { data: batch } = await supabase
      .from('collection_batches')
      .select('*, deductions:collection_deductions(*), allocations:collection_allocations(allocated_amount, orders(status, total_amount))')
      .eq('id', id)
      .maybeSingle()
    if (!batch) return NextResponse.json({ error: 'الدفعة غير موجودة' }, { status: 404 })

    if (update.received_amount !== undefined) {
      const calc = computeCollectionBatch(
        (batch.allocations || []).map((a: { orders: { total_amount: number; status: string } | null; allocated_amount?: number }) => ({
          total_amount: a.orders?.total_amount ?? a.allocated_amount ?? 0,
          status: a.orders?.status ?? 'delivered',
        })),
        batch.deductions || [],
        Number(update.received_amount)
      )
      update.status = calc.is_matched ? 'matched' : 'open'
    } else if (body.status && ['open', 'matched', 'closed'].includes(body.status)) {
      update.status = body.status
    }

    const { data, error } = await supabase
      .from('collection_batches')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'collection_batch_updated',
      entity_type: 'collection_batches',
      entity_id: id,
      old_value: { received_amount: batch.received_amount, status: batch.status },
      new_value: update,
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('PUT collections error:', error)
    return NextResponse.json({ error: 'فشل تعديل الدفعة' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'المعرف مطلوب' }, { status: 400 })

    const supabase = createServiceClient()
    const { data: before } = await supabase
      .from('collection_batches')
      .select('company_name, received_amount')
      .eq('id', id)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'الدفعة غير موجودة' }, { status: 404 })

    const { error } = await supabase.from('collection_batches').delete().eq('id', id)
    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'collection_batch_deleted',
      entity_type: 'collection_batches',
      entity_id: id,
      old_value: before,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE collections error:', error)
    return NextResponse.json({ error: 'فشل حذف الدفعة' }, { status: 500 })
  }
}
