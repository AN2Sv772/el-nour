import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * POST /api/integrations/order-confirmation/resend
 * Manually resend a confirmation for a specific order.
 * Body: { order_id: string }
 * 
 * Note: This is now a no-op since WhatsApp integration was removed.
 * Returns success with a message indicating WhatsApp is not configured.
 */
export async function POST(request: NextRequest) {
  // This endpoint triggers an outbound customer notification, so it is
  // restricted to managers and administrators.
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { order_id } = body

    if (!order_id) {
      return NextResponse.json({ error: 'حقل "order_id" مطلوب' }, { status: 400 })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Order confirmation resend is no longer available via WhatsApp.' 
    })
  } catch (error) {
    console.error('Resend confirmation error:', error)
    return NextResponse.json({ error: 'فشل إعادة إرسال التأكيد' }, { status: 500 })
  }
}
