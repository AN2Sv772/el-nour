import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { safeEqual } from '@/lib/crypto'

/**
 * POST /api/integrations/order-confirmation/cron
 * Runs reminder sending + expiration check.
 * Should be called by a cron job (Vercel Cron, external cron, or manually).
 *
 * Also handles: expiring timed-out confirmations.
 *
 * Auth (audit fix, 2026-11-20):
 *   * the route FAILED OPEN when `CRON_SECRET` was unset — anybody could
 *     run the reminder sweep;
 *   * the middleware answered 401 for this path before the route's own
 *     check could run, so the endpoint was unreachable (always 401) even
 *     for a legitimate cron call.
 * It now fails closed when the secret is missing, and the path is exempted
 * from the middleware session gate for POST only (the GET health check
 * stays behind the session).
 */
export async function POST(request: NextRequest) {
  try {
    // Fail CLOSED: without a configured secret this endpoint must not run.
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json(
        { error: 'CRON_SECRET غير مضبوط — تعطيل المسار بدل تشغيله بدون حماية' },
        { status: 503 }
      )
    }
    const authHeader = request.headers.get('authorization')
    if (!safeEqual(authHeader ?? '', `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Run reminders and expiration
    const [reminderResult, expiredCount] = await Promise.all([
      sendReminders(supabase),
      expireConfirmations(supabase),
    ])

    return NextResponse.json({
      success: true,
      reminders_sent: reminderResult.sent,
      escalated_to_human: reminderResult.escalated,
      confirmations_expired: expiredCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Order confirmation cron error:', error)
    return NextResponse.json({ error: 'فشل تشغيل التذكيرات' }, { status: 500 })
  }
}

/**
 * GET /api/integrations/order-confirmation/cron
 * Health check for the cron endpoint.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'order-confirmation-cron' })
}

// Internal functions moved here to avoid circular dependencies
async function sendReminders(supabase: any) {
  const { data: confirmations, error } = await supabase
    .from('order_confirmations')
    .select('*')
    .eq('status', 'awaiting_confirmation')
    .lt('expires_at', new Date().toISOString())

  if (error || !confirmations?.length) {
    return { sent: 0, escalated: 0 }
  }

  let sent = 0
  let escalated = 0

  for (const confirmation of confirmations) {
    // Check reminder count
    if (confirmation.reminder_count >= (confirmation.max_reminders || 2)) {
      // Escalate to human
      await supabase
        .from('order_confirmations')
        .update({ status: 'human_review' })
        .eq('id', confirmation.id)

      // Create notification for human review
      // (type 'system' — 'ai_escalation' enum value retained in DB but AI was removed)
      await supabase.from('notifications').insert({
        type: 'system',
        title: 'تأكيد طلب يحتاج مراجعة',
        message: `طلب ${confirmation.id} يحتاج مراجعة يدوية`,
        reference_id: confirmation.id,
        reference_type: 'order_confirmation',
      })

      escalated++
      continue
    }

    // Send reminder (placeholder - would integrate with SMS or other channels)
    // For now, just increment reminder count
    await supabase
      .from('order_confirmations')
      .update({
        reminder_count: confirmation.reminder_count + 1,
        last_reminder_at: new Date().toISOString(),
      })
      .eq('id', confirmation.id)

    sent++
  }

  return { sent, escalated }
}

async function expireConfirmations(supabase: any) {
  const { data: confirmations, error } = await supabase
    .from('order_confirmations')
    .select('*')
    .eq('status', 'awaiting_confirmation')
    .lt('expires_at', new Date().toISOString())

  if (error || !confirmations?.length) {
    return 0
  }

  let expiredCount = 0

  for (const confirmation of confirmations) {
    await supabase
      .from('order_confirmations')
      .update({ status: 'expired' })
      .eq('id', confirmation.id)

    // Log event
    await supabase.from('order_confirmation_events').insert({
      confirmation_id: confirmation.id,
      event_type: 'expired',
      event_data: {},
    })

    expiredCount++
  }

  return expiredCount
}
