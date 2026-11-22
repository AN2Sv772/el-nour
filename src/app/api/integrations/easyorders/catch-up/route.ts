import { NextRequest, NextResponse, after } from 'next/server'
import { requireRole } from '@/lib/supabase/require-role'
import { catchUpNewOrders, getBackfillStatus } from '@/lib/easyorders/backfill'
import { drainQueue, getQueueStats, reclaimStuckEvents } from '@/lib/easyorders/queue'
import { recordEasyOrdersSyncRun } from '@/lib/easyorders/sync'
import { createServiceClient } from '@/lib/supabase/service'
import { getInternalTriggerSecret, INTERNAL_TRIGGER_HEADER, selfOrigin } from '@/lib/easyorders/internal-trigger'
import { safeEqual } from '@/lib/crypto'

/**
 * GET  /api/integrations/easyorders/catch-up
 *
 * Safety net for orders that were created while the importer was idle.
 *
 * A finished backfill leaves `backfill_status = 'done'`, and the batch
 * runner returns immediately in that state — so an order created afterwards
 * was never fetched. This endpoint re-checks the store's highest short_id
 * and resumes the scan from the current cursor when it has grown.
 *
 * Auth: Vercel Cron (`Authorization: Bearer $CRON_SECRET`) or an ADMIN
 * session. The self-chaining kick uses the internal trigger secret, so it
 * cannot be forged from outside.
 *
 * The user path used to accept ANY authenticated role (viewer included),
 * which let a read-only account trigger a live import — a write action
 * behind a read-only permission.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const isCron = cronSecret ? safeEqual(authHeader ?? '', `Bearer ${cronSecret}`) : false

  if (!isCron) {
    const auth = await requireRole('admin')
    if (auth instanceof NextResponse) return auth
  }

  try {
    const startedAt = Date.now()
    const result = await catchUpNewOrders()
    const status = await getBackfillStatus()

    // Drain the durable webhook queue as part of the same daily run.
    //
    // Vercel's HOBBY plan only allows DAILY crons (a sub-daily schedule is
    // rejected at deploy time), so a separate "every minute" drain cron is
    // not an option on this account. The queue is still drained promptly in
    // practice because the webhook route kicks the processor itself after
    // every accepted delivery (Next.js `after()`), and this daily run is the
    // safety net for events whose kick was lost.
    const reclaimed = await reclaimStuckEvents()
    const drained = await drainQueue(25)
    const queue = await getQueueStats()

    // ONE sync-log row for this run (F-013).
    //
    // The catch-up is the daily safety net that actually pulls the store's
    // orders in — before this change it left NO row in `easyorders_sync_logs`
    // (the table stopped at 2026-11-06 while 2 022 orders were imported
    // afterwards). The row and the counter update are written together by
    // the database function, so a run can no longer be counted without being
    // logged (F-012).
    await recordEasyOrdersSyncRun(createServiceClient(), {
      syncType: 'catch-up',
      status: 'success',
      processed: drained.processed,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: drained.failed,
      durationMs: Date.now() - startedAt,
      errors: drained.errors.slice(0, 10),
    })

    if (result.needed || drained.processed > 0 || drained.failed > 0) {
      // Kick the processing chain so the new orders are actually imported.
      after(async () => {
        const origin = selfOrigin(new URL(request.url).origin)
        await fetch(`${origin}/api/integrations/easyorders/process-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [INTERNAL_TRIGGER_HEADER]: getInternalTriggerSecret() ?? '',
          },
          body: JSON.stringify({}),
        }).catch(() => {})
      })
    }

    return NextResponse.json({
      success: true,
      ...result,
      status,
      queue: {
        reclaimed,
        processed: drained.processed,
        failed: drained.failed,
        dead_lettered: drained.dead_lettered,
        stats: queue,
        errors: drained.errors.slice(0, 10),
      },
    })
  } catch (error) {
    console.error('catch-up error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'catch-up failed' },
      { status: 500 }
    )
  }
}
