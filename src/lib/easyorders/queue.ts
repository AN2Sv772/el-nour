import { createServiceClient } from '@/lib/supabase/service'
import { easyOrdersSyncService } from '@/lib/easyorders/sync'
import { easyOrdersService } from '@/lib/easyorders/service'
import { randomUUID } from 'crypto'

/**
 * Durable event-queue processor for EasyOrders webhooks.
 *
 * Flow: webhook route acknowledges (202) after durable INSERT; this processor
 * claims events atomically (claim_webhook_events uses FOR UPDATE SKIP LOCKED),
 * processes them, and applies bounded retries with exponential backoff.
 * Permanent failures (invalid payload) go straight to dead_letter.
 * Temporary failures retry up to max_attempts, then dead_letter.
 *
 * Triggered by: Vercel Cron (every minute) or manual "process now" action.
 */

export interface QueueStats {
  pending: number
  processing: number
  processed: number
  failed: number
  dead_letter: number
}

export interface ProcessedResult {
  claimed: number
  processed: number
  failed: number
  dead_lettered: number
  /** Events returned to the pending pool because their worker died. */
  reclaimed: number
  errors: string[]
}

/** Max attempts before dead-letter (attempts includes the first try). */
const MAX_ATTEMPTS = 5

/**
 * Extract a human-readable message from an unknown throwable.
 *
 * `error instanceof Error` is NOT enough: PostgREST raises plain
 * `PostgrestError` objects (a `{ message, code, details }` literal, not an
 * Error subclass), and cross-realm errors also fail the `instanceof` check.
 * Without this, every database error was recorded as "unknown error" and
 * dead-letter rows were impossible to diagnose.
 */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; details?: unknown }
    if (typeof e.message === 'string' && e.message) {
      const code = typeof e.code === 'string' && e.code ? `[${e.code}] ` : ''
      const details = typeof e.details === 'string' && e.details ? ` — ${e.details}` : ''
      return `${code}${e.message}${details}`
    }
    try {
      return JSON.stringify(error).slice(0, 300)
    } catch {
      return 'unknown error'
    }
  }
  return 'unknown error'
}

/** Exponential backoff: 1m, 2m, 4m, 8m, 16m (capped). */
function backoffDelay(attempt: number): number {
  return Math.min(60_000 * Math.pow(2, attempt - 1), 60_000 * 16)
}

export async function getQueueStats(): Promise<QueueStats> {
  const supabase = createServiceClient()

  // Count per status with `count=exact` + head requests: a plain SELECT of
  // the status column is capped by PostgREST's max-rows (1000), which would
  // silently under-report the queue once it grows past that.
  const stats: QueueStats = { pending: 0, processing: 0, processed: 0, failed: 0, dead_letter: 0 }
  const statuses = Object.keys(stats) as (keyof QueueStats)[]

  for (const status of statuses) {
    const { count, error } = await supabase
      .from('easyorders_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('processing_status', status)

    if (error) {
      console.error(`queue stats: failed to count '${status}':`, error.message)
      continue
    }
    stats[status] = count ?? 0
  }

  return stats
}

/** Process one claimed event. Returns true on success. Throws on retryable failure. */
async function processEvent(eventId: string, eventType: string, payload: unknown): Promise<void> {
  const supabase = createServiceClient()

  const { eventType: normalized, data } = easyOrdersService.parseEvent(payload)

  if (normalized === 'unknown') {
    // Permanent: not a recognizable EasyOrders event
    const err = new Error('UNRECOGNIZED_EVENT')
    ;(err as Error & { permanent?: boolean }).permanent = true
    throw err
  }

  await easyOrdersSyncService.processWebhookEvent(normalized, data ?? payload)

  await supabase
    .from('easyorders_webhook_events')
    .update({
      processing_status: 'processed',
      processed: true,
      processed_at: new Date().toISOString(),
      last_error: null,
      claimed_at: null,
      claimed_by: null,
    })
    .eq('id', eventId)
}

/**
 * How long a claimed event may stay in `processing` before it is considered
 * abandoned. A worker that dies mid-event (deployment, timeout, OOM) leaves
 * the row in `processing` FOREVER — the drain query only looks at
 * `pending`/`failed`, so those events were never processed again.
 */
export const STUCK_CLAIM_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Return events that were claimed but never finished to the pending pool.
 *
 * The retry budget is NOT reset: the attempts counter is left as-is, so an
 * event that keeps killing its worker still ends up in the dead-letter box
 * instead of looping forever.
 */
export async function reclaimStuckEvents(): Promise<number> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - STUCK_CLAIM_TIMEOUT_MS).toISOString()

  const { data, error } = await supabase
    .from('easyorders_webhook_events')
    .update({
      processing_status: 'pending',
      claimed_at: null,
      claimed_by: null,
      next_retry_at: new Date().toISOString(),
      last_error: 'reclaimed: the previous worker never finished this event',
    })
    .eq('processing_status', 'processing')
    .lt('claimed_at', cutoff)
    .select('id')

  if (error) {
    console.error('queue reclaim: failed to reclaim stuck events:', error.message)
    return 0
  }
  if (data && data.length > 0) {
    console.warn(`queue reclaim: returned ${data.length} stuck event(s) to the pending pool`)
  }
  return data?.length ?? 0
}

/** Drain the queue: claim + process up to batchSize events. */
export async function drainQueue(batchSize = 10): Promise<ProcessedResult> {
  const supabase = createServiceClient()
  const workerId = `worker-${randomUUID().slice(0, 8)}`

  const result: ProcessedResult = {
    claimed: 0,
    processed: 0,
    failed: 0,
    dead_lettered: 0,
    reclaimed: 0,
    errors: [],
  }

  // Recover events whose worker died before finishing them.
  result.reclaimed = await reclaimStuckEvents()

  // Atomic claim: two-step (select candidates → conditional update per row).
  // The conditional UPDATE ... eq(processing_status,'pending') acts as
  // test-and-set; a concurrent worker's update changes the status so our
  // update matches 0 rows — no double claim. Avoids RPC/trigger issues.
  const now = new Date().toISOString()
  const { data: candidates } = await supabase
    .from('easyorders_webhook_events')
    .select('id, event_type, payload, attempts, max_attempts')
    .in('processing_status', ['pending', 'failed'])
    .lte('next_retry_at', now)
    .or(`claimed_at.is.null,claimed_at.lt.${new Date(Date.now() - 120_000).toISOString()}`)
    .order('created_at')
    .limit(batchSize)

  const claimed: { id: string; event_type: string; payload: unknown; attempts: number; max_attempts: number }[] = []
  for (const cand of candidates || []) {
    const { data: won, error: claimErr } = await supabase
      .from('easyorders_webhook_events')
      .update({
        processing_status: 'processing',
        claimed_at: now,
        claimed_by: workerId,
        attempts: (cand.attempts ?? 0) + 1,
      })
      .eq('id', cand.id)
      .in('processing_status', ['pending', 'failed'])
      .select('id, event_type, payload, attempts, max_attempts')

    if (claimErr) {
      result.errors.push(`claim ${cand.id}: ${claimErr.message}`)
      continue
    }
    if (won && won.length > 0) claimed.push(won[0])
  }

  result.claimed = claimed.length

  for (const event of claimed || []) {
    try {
      await processEvent(event.id, event.event_type, event.payload)
      result.processed++
    } catch (error) {
      const msg = errorMessage(error)
      const permanent = (error as Error & { permanent?: boolean })?.permanent === true
      const attempts = event.attempts ?? 1
      // Honour the per-row max_attempts column (it defaults to MAX_ATTEMPTS);
      // it was previously ignored, so a row configured for fewer attempts
      // was still retried the full five times.
      const maxAttempts = (event as { max_attempts?: number }).max_attempts ?? MAX_ATTEMPTS

      if (permanent || attempts >= maxAttempts) {
        await supabase
          .from('easyorders_webhook_events')
          .update({
            processing_status: 'dead_letter',
            last_error: msg.slice(0, 500),
            claimed_at: null,
            claimed_by: null,
          })
          .eq('id', event.id)
        result.dead_lettered++
        result.errors.push(`event ${event.id}: dead-lettered (${msg})`)
      } else {
        await supabase
          .from('easyorders_webhook_events')
          .update({
            processing_status: 'failed',
            last_error: msg.slice(0, 500),
            next_retry_at: new Date(Date.now() + backoffDelay(attempts)).toISOString(),
            claimed_at: null,
            claimed_by: null,
          })
          .eq('id', event.id)
        result.failed++
        result.errors.push(`event ${event.id}: retry ${attempts}/${maxAttempts} (${msg})`)
      }
    }
  }

  return result
}

/** Retry all dead-lettered events (manual admin action). */
export async function retryDeadLetters(): Promise<number> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('easyorders_webhook_events')
    .update({
      processing_status: 'pending',
      attempts: 0,
      next_retry_at: new Date(Date.now() + 1000).toISOString(),
      last_error: null,
    })
    .eq('processing_status', 'dead_letter')
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}

