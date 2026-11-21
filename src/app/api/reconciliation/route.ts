import { NextRequest, NextResponse } from 'next/server'
import { fetchAllByIds } from '@/lib/supabase/paginate'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { computeProvisional, computeReconciled, round2 } from '@/lib/finance'

/**
 * GET  /api/reconciliation?date=YYYY-MM-DD   → computed preview + saved record
 * GET  /api/reconciliation?list=1            → recent reconciliations
 * POST /api/reconciliation                   → close a business day
 *   body: { business_date, returned_orders_count, items: [{product_id, quantity_returned}], notes? }
 * PUT  /api/reconciliation?id=               → reopen (recalculates, keeps audit)
 */
type OrderRow = { id: string; total_amount: number; shipping_fee: number; status: string }
type ItemRow = { order_id: string; quantity: number; unit_cost: number | null; product_id: string }
type ExpenseRow = { amount: number; category: string; voided_at: string | null }

export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const sp = request.nextUrl.searchParams

    if (sp.get('list')) {
      const { data, error } = await supabase
        .from('daily_reconciliations')
        .select('*')
        .order('business_date', { ascending: false })
        .limit(60)
      if (error) throw error
      return NextResponse.json({ data: data || [] })
    }

    const date = sp.get('date') || new Date().toISOString().slice(0, 10)

    // Preview computation for the requested business date
    const { data: orders, error: oErr } = await supabase
      .from('orders')
      .select('id, total_amount, shipping_fee, status, created_at')
      .gte('created_at', `${date}T00:00:00`)
      .lte('created_at', `${date}T23:59:59.999`)
    if (oErr) throw oErr

    const orderIds = (orders || []).map(o => o.id)
    let items: ItemRow[] = []
    if (orderIds.length > 0) {
      items = await fetchAllByIds<{ order_id: string; quantity: number; unit_cost: number | null; product_id: string }>(
        (chunkIds) => (from, to) =>
          supabase.from('order_items').select('order_id, quantity, unit_cost, product_id')
            .in('order_id', chunkIds).order('id', { ascending: true }).range(from, to),
        orderIds
      )
    }

    const { data: expenses, error: eErr } = await supabase
      .from('expenses')
      .select('amount, category, voided_at')
      .gte('expense_date', date)
      .lte('expense_date', date)
    if (eErr) throw eErr

    // Cost fallback: current product cost when snapshot missing
    const productIds = [...new Set(items.map(i => i.product_id))]
    const costFallback: Record<string, number> = {}
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, cost_price')
        .in('id', productIds)
      for (const p of prods || []) costFallback[p.id] = p.cost_price ?? 0
    }

    const provisional = computeProvisional(
      (orders || []) as unknown as never,
      items as unknown as never,
      (expenses || []) as unknown as never,
      costFallback
    )

    const { data: saved } = await supabase
      .from('daily_reconciliations')
      .select('*, items:daily_reconciliation_items(*)')
      .eq('business_date', date)
      .maybeSingle()

    // Default shipping estimate when no shipping expenses recorded —
    // uses the REAL configured default from business_settings
    const shippingRecorded = (expenses || []).some(e => e.category === 'shipping' && !e.voided_at)
    let defaultShippingFee = 30
    if (!shippingRecorded) {
      const { data: settings } = await supabase
        .from('business_settings')
        .select('default_shipping_fee')
        .limit(1)
        .maybeSingle()
      if (settings?.default_shipping_fee !== null && settings?.default_shipping_fee !== undefined) {
        defaultShippingFee = Number(settings.default_shipping_fee) || 30
      }
    }
    const shippingEstimate = !shippingRecorded ? round2(provisional.orders_count * defaultShippingFee) : 0

    return NextResponse.json({
      date,
      provisional,
      saved: saved || null,
      shipping_estimate: shippingEstimate,
      shipping_recorded: shippingRecorded,
    })
  } catch (error) {
    console.error('GET reconciliation error:', error)
    return NextResponse.json({ error: 'فشل تحميل بيانات التسوية' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { business_date, returned_orders_count, items, notes, shipping_expenses } = body

    if (!business_date || !/^\d{4}-\d{2}-\d{2}$/.test(business_date)) {
      return NextResponse.json({ error: 'تاريخ غير صحيح' }, { status: 400 })
    }
    const returnedCount = Math.max(0, parseInt(returned_orders_count) || 0)
    const returnItems = (Array.isArray(items) ? items : []).filter(
      (i: { product_id?: string; quantity_returned?: number }) =>
        i.product_id && Number(i.quantity_returned) > 0
    )

    const supabase = createServiceClient()

    // Guard: prevent accidental double closing (UNIQUE(business_date) + explicit check)
    const { data: existing } = await supabase
      .from('daily_reconciliations')
      .select('id')
      .eq('business_date', business_date)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'تمت تسوية هذا اليوم بالفعل. استخدم إعادة الفتح للتعديل.' },
        { status: 409 }
      )
    }

    // Recompute provisional from real data (server-side source of truth)
    const { data: orders } = await supabase
      .from('orders')
      .select('id, total_amount, shipping_fee, status, created_at')
      .gte('created_at', `${business_date}T00:00:00`)
      .lte('created_at', `${business_date}T23:59:59.999`)

    const orderIds = (orders || []).map(o => o.id)
    let itemsRows: ItemRow[] = []
    if (orderIds.length > 0) {
      itemsRows = await fetchAllByIds<{ order_id: string; quantity: number; unit_cost: number | null; product_id: string }>(
        (chunkIds) => (from, to) =>
          supabase.from('order_items').select('order_id, quantity, unit_cost, product_id')
            .in('order_id', chunkIds).order('id', { ascending: true }).range(from, to),
        orderIds
      )
    }

    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, category, voided_at')
      .gte('expense_date', business_date)
      .lte('expense_date', business_date)

    const productIds = [...new Set(itemsRows.map(i => i.product_id))]
    const costFallback: Record<string, number> = {}
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, cost_price')
        .in('id', productIds)
      for (const p of prods || []) costFallback[p.id] = p.cost_price ?? 0
    }

    const provisional = computeProvisional(
      (orders || []) as unknown as never,
      itemsRows as unknown as never,
      (expenses || []) as unknown as never,
      costFallback
    )

    // Resolve current cost per returned product (snapshot into the row)
    const returnProductIds = returnItems.map((i: { product_id: string }) => i.product_id)
    const { data: returnProducts } = returnProductIds.length
      ? await supabase.from('products').select('id, cost_price').in('id', returnProductIds)
      : { data: [] as { id: string; cost_price: number | null }[] }
    const costById: Record<string, number> = {}
    for (const p of returnProducts || []) costById[p.id] = p.cost_price ?? 0

    const reconciled = computeReconciled({
      provisional,
      returnedOrdersCount: returnedCount,
      returnedItems: returnItems.map((i: { product_id: string; quantity_returned: number }) => ({
        quantity_returned: Number(i.quantity_returned),
        unit_cost: costById[i.product_id] ?? 0,
      })),
    })

    const shippingExpenses = shipping_expenses !== undefined
      ? Math.max(0, Number(shipping_expenses) || 0)
      : round2(
          (expenses || [])
            .filter(e => e.category === 'shipping' && !e.voided_at)
            .reduce((s, e) => s + (e.amount || 0), 0)
        )
    const expensesTotal = round2(
      (expenses || []).filter(e => !e.voided_at).reduce((s, e) => s + (e.amount || 0), 0)
    )

    // ATOMIC close via DB function (single transaction: row + items +
    // movements + stock — partial failure rolls back everything)
    const { data: recId, error: rpcError } = await supabase
      .rpc('close_daily_reconciliation', {
        p_business_date: business_date,
        p_orders_count: provisional.orders_count,
        p_provisional_sales: provisional.provisional_sales,
        p_provisional_cogs: provisional.provisional_cogs,
        p_provisional_profit: provisional.provisional_profit,
        p_returned_orders_count: reconciled.returned_orders_count,
        p_returned_orders_value: reconciled.returned_orders_value,
        p_returned_products_value: reconciled.returned_products_value,
        p_shipping_expenses: shippingExpenses,
        p_expenses_total: expensesTotal,
        p_reconciled_profit: reconciled.reconciled_profit,
        p_notes: notes || null,
        p_user_id: auth.user.id,
        p_return_items: returnItems.map((i: { product_id: string; quantity_returned: number }) => ({
          product_id: i.product_id,
          quantity_returned: Number(i.quantity_returned),
          unit_cost: costById[i.product_id] ?? 0,
        })),
      })
    if (rpcError) throw rpcError

    const { data: rec } = await supabase
      .from('daily_reconciliations')
      .select('*')
      .eq('id', recId)
      .single()

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'reconciliation_created',
      entity_type: 'daily_reconciliations',
      entity_id: rec.id,
      new_value: { business_date, returned_orders_count: returnedCount, reconciled_profit: rec.reconciled_profit },
    })

    return NextResponse.json({ success: true, data: rec })
  } catch (error) {
    console.error('POST reconciliation error:', error)
    const msg = error instanceof Error ? error.message : ''
    return NextResponse.json(
      { error: msg.includes('duplicate') ? 'تمت تسوية هذا اليوم بالفعل' : `فشل حفظ التسوية: ${msg}` },
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
    const { notes, returned_orders_count } = body

    const supabase = createServiceClient()
    const { data: before } = await supabase
      .from('daily_reconciliations')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'التسوية غير موجودة' }, { status: 404 })

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      reopened_at: new Date().toISOString(),
      reopened_by: auth.user.id,
    }
    if (notes !== undefined) update.notes = notes
    if (returned_orders_count !== undefined) {
      const newCount = Math.max(0, parseInt(returned_orders_count) || 0)
      update.returned_orders_count = newCount
      // Recompute the estimate with the new count
      const avg = before.orders_count > 0 ? before.provisional_sales / before.orders_count : 0
      const newValue = round2(newCount * avg)
      update.returned_orders_value = newValue
      update.reconciled_profit = round2(
        before.provisional_profit - newValue + before.returned_products_value
      )
    }

    const { data, error } = await supabase
      .from('daily_reconciliations')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'reconciliation_edited',
      entity_type: 'daily_reconciliations',
      entity_id: id,
      old_value: {
        returned_orders_count: before.returned_orders_count,
        reconciled_profit: before.reconciled_profit,
        notes: before.notes,
      },
      new_value: update,
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('PUT reconciliation error:', error)
    return NextResponse.json({ error: 'فشل تعديل التسوية' }, { status: 500 })
  }
}
