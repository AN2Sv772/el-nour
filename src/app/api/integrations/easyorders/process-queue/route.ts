import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { drainQueue, getQueueStats, retryDeadLetters } from '@/lib/easyorders/queue'
import { getBackfillStatus } from '@/lib/easyorders/backfill'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { getInternalTriggerSecret, INTERNAL_TRIGGER_HEADER, isValidInternalTrigger, selfOrigin } from '@/lib/easyorders/internal-trigger'
import { safeEqual } from '@/lib/crypto'

/**
 * Give the processor enough wall-clock to finish a backfill batch AND to
 * fire the self-chaining follow-up call. Without an explicit budget the
 * function was frozen right after the response, so the chain died and the
 * historical backfill stalled permanently.
 */
export const maxDuration = 60

/**
 * POST /api/integrations/easyorders/process-queue
 *
 * Drains the durable webhook event queue. Triggered by:
 *  - Vercel Cron (every minute) via CRON_SECRET header
 *  - The webhook route itself (fire-and-forget kick)
 *  - Manual "process now" from the integrations page (authenticated)
 *
 * Actions:
 *  - default: claim + process pending/failed events (retry w/ backoff)
 *  - body { action: 'retry_dead_letters' }: requeue dead-lettered events
 *  - body { action: 'stats' }: return queue statistics only
 */
export async function POST(request: NextRequest) {
  const supabase = createServiceClient()

  // Auth: cron secret OR authenticated user
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const isCron = cronSecret ? safeEqual(authHeader ?? '', `Bearer ${cronSecret}`) : false
  const isQueueKick = isValidInternalTrigger(request.headers.get(INTERNAL_TRIGGER_HEADER))

  let body: { action?: string } = {}
  try {
    body = await request.json()
  } catch {
    // no body — default drain
  }

  if (!isCron && !isQueueKick) {
    const auth = await requireRole('manager')
    if (auth instanceof NextResponse) return auth
  }

  try {
    if (body.action === 'stats') {
      const stats = await getQueueStats()
      const bf = await getBackfillStatusSafe()
      // Self-heal: visit to the integrations page resumes stalled chains
      if (stats.pending > 0 || stats.failed > 0 || (bf && bf.status === 'running')) {
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
      return NextResponse.json({ success: true, stats })
    }

    if (body.action === 'retry_dead_letters') {
      // Manual retry is an authenticated admin action
      const auth = await requireUser()
      if (auth instanceof NextResponse) return auth
      const requeued = await retryDeadLetters()
      const drain = await drainQueue(20)
      return NextResponse.json({ success: true, requeued, ...drain })
    }

    const result = await drainQueue(10)
    const stats = await getQueueStats()

    // Then advance the historical backfill with the remaining rate budget
    let backfill: unknown = null
    let moreWork = false
    try {
      const { runBackfillBatch } = await import('@/lib/easyorders/backfill')
      backfill = await runBackfillBatch()
      const bf = backfill as { done?: boolean; error?: string }
      // SELF-CHAINING: schedule the next batch while work remains — no cron
      // needed. Each chain link is a fresh invocation (respects serverless).
      moreWork = !bf.done && !bf.error
    } catch (e) {
      backfill = { error: e instanceof Error ? e.message : 'backfill batch failed' }
    }

    // Re-kick after the response is sent when there is more work
    // (queue backlog or backfill in progress). The chain self-terminates
    // when everything is drained.
    if (moreWork || result.claimed > 0 || stats.pending > 0) {
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

    return NextResponse.json({ success: true, ...result, stats, backfill })
  } catch (error) {
    console.error('process-queue error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'queue processing failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // Queue statistics + the self-healing kick are an internal worker surface:
  // admin only. (It used to accept any authenticated role, including viewer.)
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth
  const stats = await getQueueStats()

  // SELF-HEALING: opening the integrations page re-kicks stalled chains
  // (e.g. after a cold start killed a backfill batch).
  if (stats.pending > 0 || stats.failed > 0) {
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

  return NextResponse.json({ success: true, stats })
}

async function getBackfillStatusSafe() {
  try {
    return await getBackfillStatus()
  } catch {
    return null
  }
}
