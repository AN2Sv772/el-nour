import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * GET /api/integrations/order-confirmation
 * Returns confirmation settings + statistics (all from real DB data).
 */
export async function GET() {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()

    // Get settings
    const { data: settings } = await supabase
      .from('order_confirmation_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    // Get statistics
    const [totalPending, totalConfirmed, totalCancelled, totalModification, totalExpired, totalHumanReview] =
      await Promise.all([
        supabase.from('order_confirmations').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_confirmation'),
        supabase.from('order_confirmations').select('*', { count: 'exact', head: true }).eq('status', 'confirmed'),
        supabase.from('order_confirmations').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
        supabase.from('order_confirmations').select('*', { count: 'exact', head: true }).eq('status', 'modification_requested'),
        supabase.from('order_confirmations').select('*', { count: 'exact', head: true }).eq('status', 'expired'),
        supabase.from('order_confirmations').select('*', { count: 'exact', head: true }).eq('status', 'human_review'),
      ])

    const confirmed = totalConfirmed.count || 0
    const totalAll =
      (totalPending.count || 0) +
      confirmed +
      (totalCancelled.count || 0) +
      (totalModification.count || 0) +
      (totalExpired.count || 0) +
      (totalHumanReview.count || 0)

    const confirmationRate = totalAll > 0 ? Math.round((confirmed / totalAll) * 100) : 0

    // Get recent confirmations for the table
    const { data: recent } = await supabase
      .from('order_confirmations')
      .select(`
        id,
        status,
        customer_phone,
        customer_name,
        confirmed_at,
        responded_at,
        created_at,
        reminder_count,
        modification_type,
        cancellation_reason,
        orders(order_number, total_amount, easyorders_order_id)
      `)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      settings: settings || null,
      stats: {
        awaiting: totalPending.count || 0,
        confirmed,
        cancelled: totalCancelled.count || 0,
        modification: totalModification.count || 0,
        expired: totalExpired.count || 0,
        human_review: totalHumanReview.count || 0,
        total: totalAll,
        confirmation_rate: confirmationRate,
      },
      recent: recent || [],
    })
  } catch (error) {
    console.error('GET order confirmation error:', error)
    return NextResponse.json({ error: 'فشل تحميل بيانات التأكيد' }, { status: 500 })
  }
}

/**
 * PUT /api/integrations/order-confirmation
 * Save confirmation settings.
 */
export async function PUT(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const supabase = createServiceClient()

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

    const allowedFields = [
      'enabled', 'message_template', 'confirmation_timeout_hours',
      'reminder_enabled', 'reminder_interval_hours', 'max_reminders',
      'working_hours_enabled', 'working_hours_start', 'working_hours_end',
      'eligibility_min_total', 'eligibility_payment_methods', 'eligibility_statuses',
      'fallback_message', 'timeout_message',
    ]

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const { data: existing } = await supabase
      .from('order_confirmation_settings')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('order_confirmation_settings')
        .update(updateData)
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('order_confirmation_settings')
        .insert(updateData)
      if (error) throw error
    }

    return NextResponse.json({ success: true, message: 'تم حفظ إعدادات التأكيد بنجاح' })
  } catch (error) {
    console.error('PUT order confirmation settings error:', error)
    return NextResponse.json({ error: 'فشل حفظ الإعدادات' }, { status: 500 })
  }
}
