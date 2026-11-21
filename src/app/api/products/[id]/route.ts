import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * GET /api/products/[id] — single product
 * PATCH /api/products/[id] — edit product; cost changes recorded in
 * product_cost_history (audit trail). Cost edits NEVER rewrite historical
 * order profitability (order lines keep their unit_cost snapshots).
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'فشل تحميل المنتج' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'المنتج غير موجود' }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const { id } = await ctx.params
    const body = await request.json()

    const update: Record<string, unknown> = {}
    const allowed = ['name', 'name_ar', 'sku', 'category', 'price', 'cost_price', 'low_stock_threshold', 'description', 'is_active', 'track_inventory'] as const
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key]
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'لا يوجد تغيير' }, { status: 400 })
    }
    update.updated_at = new Date().toISOString()

    const supabase = createServiceClient()

    const { data: before } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'المنتج غير موجود' }, { status: 404 })

    // SKU uniqueness check if changed
    if (update.sku && update.sku !== before.sku) {
      const { data: dup } = await supabase
        .from('products')
        .select('id')
        .eq('sku', update.sku)
        .neq('id', id)
        .maybeSingle()
      if (dup) return NextResponse.json({ error: 'SKU مستخدم بالفعل لمنتج آخر' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('products')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    // Cost audit trail: historical order profitability is untouched
    if (update.cost_price !== undefined && Number(update.cost_price) !== Number(before.cost_price ?? 0)) {
      await supabase.from('product_cost_history').insert({
        product_id: id,
        old_cost: before.cost_price,
        new_cost: Number(update.cost_price),
        changed_by: auth.user.id,
      })
      await supabase.from('audit_log').insert({
        user_id: auth.user.id,
        action: 'product_cost_changed',
        entity_type: 'products',
        entity_id: id,
        old_value: { cost_price: before.cost_price },
        new_value: { cost_price: update.cost_price },
      })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('PATCH product error:', error)
    return NextResponse.json({ error: 'فشل حفظ المنتج' }, { status: 500 })
  }
}
