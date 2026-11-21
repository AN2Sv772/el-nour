import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { updateOrderSchema, validateBody } from '@/lib/validation'
import type { OrderStatus } from '@/types'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { id } = await params

    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        customer:customers(*),
        items:order_items(*),
        status_history:order_status_history(*, changed_by_user:user_profiles(*))
      `)
      .eq('id', id)
      .single()

    // PGRST116 = "0 rows" — the order does not exist. That is a 404, not a
    // 500. The previous code threw the error and answered 500 for every
    // unknown id, so the UI could not tell "missing" from "broken".
    if (error) {
      if (error.code === 'PGRST116' || /JSON object requested.*multiple/i.test(error.message)) {
        return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
      }
      throw error
    }
    if (!data) {
      return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('Get order error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch order' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  const validation = await validateBody(request, updateOrderSchema)
  if (validation.error) return validation.error

  const { data: validatedData, error: validationError } = validation
  if (validationError) return validationError

  try {
    const supabase = createServiceClient()
    const { id } = await params
    const { status, notes, tracking_number, shipping_company, cancellation_reason } = validatedData

    // Get current order
    const { data: currentOrder } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single()

    if (!currentOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    
    if (status && status !== currentOrder.status) {
      updates.status = status
      // Status change will trigger database triggers for timestamps
    }
    
    if (notes !== undefined) updates.notes = notes
    if (tracking_number !== undefined) updates.tracking_number = tracking_number
    if (shipping_company !== undefined) updates.shipping_company = shipping_company
    if (cancellation_reason !== undefined) updates.cancellation_reason = cancellation_reason

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    // Log status change
    if (status && status !== currentOrder.status) {
      await supabase.from('automation_logs').insert({
        type: 'order_updated',
        status: 'success',
        reference_id: id,
        reference_type: 'order',
        details: { from_status: currentOrder.status, to_status: status },
      })

      // Notify customer if delivered
      if (status === 'delivered') {
        await supabase.from('notifications').insert({
          user_id: auth.user.id,
          type: 'order_delivered',
          title: 'تم تسليم الطلب',
          message: `تم تسليم الطلب ${currentOrder.order_number}`,
          reference_id: id,
          reference_type: 'order',
        })
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Update order error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update order' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { id } = await params

    // An unknown id must be a 404. The previous code updated zero rows and
    // answered 200 {"success":true}, so the UI reported a cancellation that
    // never happened.
    const { data: existing, error: lookupError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) {
      return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
    }

    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Cancel order error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel order' },
      { status: 500 }
    )
  }
}
