import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { easyOrdersSyncService } from '@/lib/easyorders/sync'
import { easyOrdersService } from '@/lib/easyorders/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * POST /api/integrations/easyorders/sync
 * Manual sync trigger. Body: { sync_type?: 'full_import' | 'incremental_sync' }
 */
export async function POST(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth

  const startTime = Date.now()

  try {
    const supabase = createServiceClient()

    // Get config
    const { data: config } = await supabase
      .from('easyorders_config')
      .select('id, is_connected, api_key')
      .limit(1)
      .maybeSingle()

    if (!config || !config.is_connected || !config.api_key) {
      return NextResponse.json(
        { error: 'EasyOrders غير متصل. أضف مفتاح API واختبر الاتصال أولاً.' },
        { status: 400 }
      )
    }

    // Parse body
    let syncType: 'full_import' | 'incremental_sync' = 'incremental_sync'
    try {
      const body = await request.json()
      if (body?.sync_type === 'full_import') {
        syncType = 'full_import'
      }
    } catch {
      // default to incremental
    }

    // Create sync log entry
    const { data: syncLog, error: logError } = await supabase
      .from('easyorders_sync_logs')
      .insert({
        sync_type: 'manual',
        status: 'running',
        triggered_by: null, // Could be set from auth context
      })
      .select('id')
      .single()

    if (logError) {
      console.error('Failed to create sync log:', logError)
    }

    // OFFICIAL API FACT: EasyOrders Public API has NO endpoint to list
    // orders (GET /orders → 404). Orders arrive ONLY via webhooks. Instead
    // of a fake import, verify the key and return the webhook instructions.
    try {
      await easyOrdersService.initialize()
      const verify = await easyOrdersSyncService.verifySyncCapability()
      const durationMs = Date.now() - startTime

      // Record a sync-log entry reflecting reality
      if (syncLog?.id) {
        await supabase
          .from('easyorders_sync_logs')
          .update({
            status: verify.verified ? 'success' : 'failed',
            orders_processed: 0,
            orders_imported: 0,
            orders_updated: 0,
            orders_skipped: 0,
            orders_failed: 0,
            errors: verify.verified ? [] : [{ message: verify.message }],
            duration_ms: durationMs,
          })
          .eq('id', syncLog.id)
      }

      if (verify.verified) {
        // Persist verified state + store id
        await supabase
          .from('easyorders_config')
          .update({
            is_connected: true,
            store_id: verify.storeId,
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'success',
            last_sync_error: null,
          })
          .eq('id', config.id)

        return NextResponse.json({
          success: true,
          webhook_based: true,
          message: verify.message,
          store: { id: verify.storeId },
          stats: { imported: 0, updated: 0, skipped: 0, errors: 0, duration_ms: durationMs },
        })
      }

      await supabase
        .from('easyorders_config')
        .update({
          last_sync_status: 'failed',
          last_sync_error: verify.message,
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', config.id)

      return NextResponse.json({ error: verify.message }, { status: 400 })
    } catch (syncError) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        syncError instanceof Error ? syncError.message : 'Unknown sync error'

      // Update sync log with failure
      if (syncLog?.id) {
        await supabase
          .from('easyorders_sync_logs')
          .update({
            status: 'failed',
            errors: [{ message: errorMessage }],
            duration_ms: durationMs,
          })
          .eq('id', syncLog.id)
      }

      // Update config status
      await supabase
        .from('easyorders_config')
        .update({
          last_sync_status: 'failed',
          last_sync_error: errorMessage,
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', config.id)

      return NextResponse.json(
        { error: `فشلت المزامنة: ${errorMessage}` },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('EasyOrders sync error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء المزامنة' }, { status: 500 })
  }
}

/**
 * GET /api/integrations/easyorders/sync
 * Returns recent sync logs.
 */
export async function GET() {
  // Authentication: verify the caller's JWT with Supabase Auth.
  // The sync log exposes integration internals (ids, counters, errors) —
  // admin only. (It used to accept any authenticated role, including viewer.)
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()

    const { data: logs, error } = await supabase
      .from('easyorders_sync_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error

    return NextResponse.json({ sync_logs: logs || [] })
  } catch (error) {
    console.error('GET sync logs error:', error)
    return NextResponse.json({ error: 'فشل تحميل سجل المزامنة' }, { status: 500 })
  }
}
