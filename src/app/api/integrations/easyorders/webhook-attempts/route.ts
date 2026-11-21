import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * GET /api/integrations/easyorders/webhook-attempts
 *
 * Authenticated diagnostics: returns the most recent webhook attempt records
 * (including REJECTED ones) so misconfiguration — wrong URL in EasyOrders or
 * a mismatched secret — is visible inside the dashboard instead of being a
 * silent 401.
 */
export async function GET() {
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data: logs, error } = await supabase
      .from('automation_logs')
      .select('id, type, status, details, created_at')
      .in('type', ['order_created', 'order_updated', 'webhook_received'])
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error

    return NextResponse.json({ attempts: logs || [] })
  } catch (error) {
    console.error('webhook-attempts error:', error)
    return NextResponse.json({ attempts: [], error: 'فشل تحميل سجل المحاولات' }, { status: 500 })
  }
}
