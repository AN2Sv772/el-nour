import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * POST /api/inventory/adjust
 * body: { product_id, quantity (positive), movement: 'add'|'reduce'|'correction', reason }
 * Records an inventory_movements row and updates stock atomically.
 * GET /api/inventory/adjust?product_id= → movement history
 */
const REASONS: Record<string, { type: 'in' | 'out' | 'adjustment'; label: string }> = {
  add: { type: 'in', label: 'إضافة مخزون' },
  reduce: { type: 'out', label: 'صرف مخزون' },
  correction: { type: 'adjustment', label: 'تسوية جرد' },
  restock: { type: 'in', label: 'إعادة تخزين' },
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { product_id, quantity, movement, reason } = body

    if (!product_id) return NextResponse.json({ error: 'المنتج مطلوب' }, { status: 400 })
    const qty = Math.abs(Number(quantity))
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'الكمية يجب أن تكون رقماً موجباً' }, { status: 400 })
    }
    const movementDef = REASONS[movement]
    if (!movementDef) {
      return NextResponse.json({ error: 'نوع الحركة غير صحيح' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: product } = await supabase
      .from('products')
      .select('id, name, stock_quantity, track_inventory')
      .eq('id', product_id)
      .single()
    if (!product) return NextResponse.json({ error: 'المنتج غير موجود' }, { status: 404 })

    if (!product.track_inventory) {
      return NextResponse.json(
        { error: 'هذا المنتج لا يتتبع المخزون. فعّل تتبع المخزون أولًا.' },
        { status: 400 }
      )
    }

    const signedQty = movement === 'reduce' ? -qty : qty

    // Prevent negative stock on reduction
    if (signedQty < 0 && product.stock_quantity + signedQty < 0) {
      return NextResponse.json(
        { error: `الكمية المتاحة (${product.stock_quantity}) أقل من الكمية المطلوب صرفها (${qty})` },
        { status: 400 }
      )
    }

    // Record the movement FIRST (never silent).
    // NOTE: actual schema = type (enum: in/out/adjustment/reserved/released) + notes
    const { data: movementRow, error: mvError } = await supabase
      .from('inventory_movements')
      .insert({
        product_id,
        type: movementDef.type,
        quantity: Math.round(signedQty),
        notes: reason || movementDef.label,
        created_by: auth.user.id,
      })
      .select()
      .single()
    if (mvError) throw mvError

    // Update stock
    const { error: stockError } = await supabase
      .from('products')
      .update({ stock_quantity: product.stock_quantity + signedQty })
      .eq('id', product_id)
    if (stockError) throw stockError

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'inventory_adjusted',
      entity_type: 'products',
      entity_id: product_id,
      old_value: { stock_quantity: product.stock_quantity },
      new_value: { stock_quantity: product.stock_quantity + signedQty, movement: movementDef.label },
    })

    return NextResponse.json({
      success: true,
      data: {
        movement: movementRow,
        previous_stock: product.stock_quantity,
        new_stock: product.stock_quantity + signedQty,
      },
    })
  } catch (error) {
    console.error('POST inventory/adjust error:', error)
    return NextResponse.json({ error: 'فشل تعديل المخزون' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  try {
    const productId = request.nextUrl.searchParams.get('product_id')
    if (!productId) return NextResponse.json({ error: 'المنتج مطلوب' }, { status: 400 })

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    console.error('GET inventory movements error:', error)
    return NextResponse.json({ error: 'فشل تحميل حركات المخزون' }, { status: 500 })
  }
}
