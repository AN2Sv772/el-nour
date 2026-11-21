import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { buildOrderQuery, ORDER_STATUSES, type OrderFilters } from '@/lib/orders/query'
import { formatNumber } from '@/lib/utils'

/**
 * POST /api/orders/bulk
 *
 * Bulk operations over REAL order records.
 *
 * Actions:
 *   { action: 'ids', filters }            → the ids of every order matching
 *                                           the current filters (used by
 *                                           "select all matching orders"
 *                                           across pagination)
 *   { action: 'update_status', ids, status } → change the status of many
 *                                           orders, reporting per-record
 *                                           success/failure
 *
 * Every action is authorised and every record is a real database row — no
 * simulated results.
 */

/** Upper bound on the "select all matching" id list. */
const MAX_SELECTED_IDS = 5000

function readFilters(body: Record<string, unknown>): OrderFilters {
  const f = (body.filters ?? {}) as Record<string, unknown>
  return {
    search: typeof f.search === 'string' ? f.search : null,
    status: typeof f.status === 'string' ? f.status : null,
    paymentStatus: typeof f.paymentStatus === 'string' ? f.paymentStatus : null,
    shippingStatus: typeof f.shippingStatus === 'string' ? f.shippingStatus : null,
    customerId: typeof f.customerId === 'string' ? f.customerId : null,
    productId: typeof f.productId === 'string' ? f.productId : null,
    dateRange: typeof f.dateRange === 'string' ? f.dateRange : null,
    from: typeof f.from === 'string' ? f.from : null,
    to: typeof f.to === 'string' ? f.to : null,
  }
}

export async function POST(request: NextRequest) {
  // Bulk mutations change real orders — require at least an employee role.
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''

  try {
    const supabase = createServiceClient()

    /* ---------------------------------------------------------------- */
    /* "Select all orders matching the current filters"                   */
    /* ---------------------------------------------------------------- */
    if (action === 'ids') {
      const filters = readFilters(body)
      const { query } = await buildOrderQuery(supabase, filters, {
        select: 'id',
        count: 'exact',
      })

      const rows = await fetchAllRows<{ id: string }>(
        (from, to) => query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
        1000
      )

      const ids = rows.map(r => r.id)
      const truncated = ids.length > MAX_SELECTED_IDS

      return NextResponse.json({
        success: true,
        ids: truncated ? ids.slice(0, MAX_SELECTED_IDS) : ids,
        count: truncated ? MAX_SELECTED_IDS : ids.length,
        truncated,
        message: truncated
          ? `تم اختيار أول ${formatNumber(MAX_SELECTED_IDS)} طلب — استخدم البحث أو الفلاتر لتضييق النطاق`
          : undefined,
      })
    }

    /* ---------------------------------------------------------------- */
    /* Bulk status change                                                  */
    /* ---------------------------------------------------------------- */
    if (action === 'update_status') {
      const ids = Array.isArray(body.ids)
        ? (body.ids as unknown[]).filter((v): v is string => typeof v === 'string')
        : []
      const status = typeof body.status === 'string' ? body.status : ''

      if (ids.length === 0) {
        return NextResponse.json({ error: 'لم يتم تحديد أي طلب' }, { status: 400 })
      }
      if (!ORDER_STATUSES.includes(status as never)) {
        return NextResponse.json({ error: 'حالة الطلب غير صالحة' }, { status: 400 })
      }
      if (ids.length > MAX_SELECTED_IDS) {
        return NextResponse.json(
          { error: `الحد الأقصى ${formatNumber(MAX_SELECTED_IDS)} طلب في العملية الواحدة` },
          { status: 400 }
        )
      }

      // Fetch the real rows first so we can report exactly which orders were
      // changed and which ones did not exist / were not permitted.
      const { data: existing, error: fetchError } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .in('id', ids)
      if (fetchError) throw fetchError

      const existingRows = existing ?? []
      const found = new Set(existingRows.map(o => o.id))
      const missing = ids.filter(id => !found.has(id))
      const alreadyAtTarget = new Set(
        existingRows.filter(o => o.status === status).map(o => o.id)
      )

      const changed: string[] = []
      const unchanged: string[] = []
      const failed: { id: string; error: string }[] = []

      // Update in chunks so a large selection does not build a huge statement.
      // Only ids that really exist are counted as changed — an UPDATE that
      // matches no row is a no-op, not a success.
      const CHUNK = 200
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK).filter(id => found.has(id))
        if (chunk.length === 0) continue
        const { error } = await supabase
          .from('orders')
          .update({ status, updated_at: new Date().toISOString() })
          .in('id', chunk)
        if (error) {
          for (const id of chunk) failed.push({ id, error: error.message })
        } else {
          for (const id of chunk) {
            if (alreadyAtTarget.has(id)) unchanged.push(id)
            else changed.push(id)
          }
        }
      }

      return NextResponse.json({
        success: failed.length === 0,
        requested: ids.length,
        changed: changed.length,
        unchanged: unchanged.length,
        missing: missing.length,
        failed: failed.length,
        failures: failed.slice(0, 20),
        missingIds: missing.slice(0, 20),
        message:
          failed.length === 0
            ? `تم تحديث ${formatNumber(changed.length)} طلب`
            : `تم تحديث ${formatNumber(changed.length)} طلب، فشل ${formatNumber(failed.length)}`,
      })
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
  } catch (error) {
    console.error('bulk orders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'فشلت العملية' },
      { status: 500 }
    )
  }
}
