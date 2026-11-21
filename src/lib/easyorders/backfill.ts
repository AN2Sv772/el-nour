import { createServiceClient } from '@/lib/supabase/service'
import { decryptSecret } from '@/lib/crypto'
import { easyOrdersSyncService, recordEasyOrdersSyncRun } from '@/lib/easyorders/sync'

/**
 * Historical orders backfill — sequential short_id scanner.
 *
 * OFFICIAL ENUMERATION PATH (verified):
 *   GET /orders/short/:short_id → 200 with the FULL order (same shape as the
 *   webhook order-created payload). short_id is sequential per store (1..N).
 *   The public API has NO orders-list endpoint — this is the only supported
 *   way to enumerate historical orders.
 *
 * Design:
 *   - Runs ONE bounded batch per invocation (~30 requests) to respect the
 *     40 req/min API rate limit; Vercel Cron re-invokes every minute.
 *   - Checkpoint (backfill_cursor) persisted after EVERY item → resumable
 *     even if the serverless invocation is killed mid-batch.
 *   - Dedup via existing easyorders_order_id + easyorders_store_id — the
 *     exact column set of the unique index `idx_orders`. The lookup's
 *     errors are surfaced (never swallowed), so a transient read failure
 *     becomes a retry instead of a phantom duplicate-key failure.
 *   - Store-id filter: only orders belonging to the configured store import.
 *   - Import goes through the SAME pipeline as webhooks (processWebhookEvent).
 */

const API_BASE = 'https://api.easy-orders.net/api/v1/external-apps'
// The public API is limited to 40 requests/minute. 15 items per batch with a
// 1.5s pace ≈ 30 req/min, which stays under the cap; the previous 4×900ms
// configuration ran at ~48 req/min and triggered 429s, wasting the quota.
// 15 also leaves headroom inside the 60s function budget — a batch of 20
// timed out (504) while importing new orders, because every new order adds
// several extra database round-trips.
const REQUESTS_PER_RUN = 15
// 1.5s between calls ⇒ 40 req/min ceiling, with headroom for latency.
const REQUEST_PACE_MS = 1500
const REQUEST_TIMEOUT_MS = 10_000

export interface BackfillStatus {
  status: string
  cursor: number
  maxId: number | null
  imported: number
  skipped: number
  failed: number
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  remaining: number | null
}

async function getApiKey(): Promise<{ apiKey: string; configId: string } | null> {
  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('easyorders_config')
    .select('id, api_key')
    .limit(1)
    .maybeSingle()
  if (!config?.api_key) return null
  const apiKey = config.api_key.startsWith('v1:') ? decryptSecret(config.api_key) : config.api_key
  return { apiKey, configId: config.id }
}

export async function getBackfillStatus(): Promise<BackfillStatus | null> {
  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('easyorders_config')
    .select('backfill_status, backfill_cursor, backfill_max_id, backfill_imported, backfill_skipped, backfill_failed, backfill_last_error, backfill_started_at, backfill_finished_at')
    .limit(1)
    .maybeSingle()
  if (!config) return null
  return {
    status: config.backfill_status,
    cursor: config.backfill_cursor,
    maxId: config.backfill_max_id,
    imported: config.backfill_imported,
    skipped: config.backfill_skipped,
    failed: config.backfill_failed,
    lastError: config.backfill_last_error,
    startedAt: config.backfill_started_at,
    finishedAt: config.backfill_finished_at,
    remaining: config.backfill_max_id ? Math.max(0, config.backfill_max_id - config.backfill_cursor) : null,
  }
}

/**
 * Discover the highest existing short_id by exponential probe + binary
 * search. Extracted from `startBackfill` so the catch-up path can check for
 * new orders without resetting the cursor.
 */
async function discoverMaxId(apiKey: string): Promise<number> {
  const exists = async (id: number): Promise<boolean> => {
    const res = await fetch(`${API_BASE}/orders/short/${id}`, {
      headers: { 'Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return res.status === 200
  }

  let lo = 1
  let hi = 256
  // exponential probe
  while (await exists(hi)) {
    lo = hi
    hi = hi * 2
    if (hi > 1_000_000) break // safety bound
  }
  // binary search
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (await exists(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Start (or restart) the backfill: discover max short_id, reset cursor. */
export async function startBackfill(): Promise<{ started: boolean; maxId: number }> {
  const creds = await getApiKey()
  if (!creds) throw new Error('EasyOrders غير مُعد — احفظ مفتاح API أولًا')

  const supabase = createServiceClient()

  const maxId = await discoverMaxId(creds.apiKey)

  await supabase
    .from('easyorders_config')
    .update({
      backfill_status: 'running',
      backfill_cursor: 0,
      backfill_max_id: maxId,
      backfill_last_error: null,
      backfill_started_at: new Date().toISOString(),
      backfill_finished_at: null,
      backfill_imported: 0,
      backfill_skipped: 0,
      backfill_failed: 0,
    })
    .eq('id', creds.configId)

  return { started: true, maxId }
}

/**
 * Catch up on orders that arrived after the last backfill run.
 *
 * Once a backfill finished, its status is `done` and `runBackfillBatch`
 * returns immediately — it never re-discovers `max_id`, so any order
 * created afterwards was invisible to the importer. That is exactly the
 * situation the store is in now (max_id grew from 1985 to 1987 while the
 * scan was idle).
 *
 * This re-checks the store's highest short_id and, when it has grown,
 * resumes the scan FROM THE CURRENT CURSOR (not from 0 — the historical
 * range is already imported) so only the genuinely new orders are fetched.
 */
export async function catchUpNewOrders(): Promise<{ needed: boolean; maxId: number | null; cursor: number }> {
  const creds = await getApiKey()
  if (!creds) return { needed: false, maxId: null, cursor: 0 }

  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('easyorders_config')
    .select('id, backfill_status, backfill_cursor, backfill_max_id')
    .limit(1)
    .maybeSingle()
  if (!config) return { needed: false, maxId: null, cursor: 0 }

  const cursor = config.backfill_cursor ?? 0
  const maxId = await discoverMaxId(creds.apiKey)

  if (maxId <= cursor) {
    return { needed: false, maxId, cursor }
  }

  await supabase
    .from('easyorders_config')
    .update({
      backfill_status: 'running',
      backfill_max_id: maxId,
      backfill_last_error: null,
      backfill_started_at: new Date().toISOString(),
      backfill_finished_at: null,
    })
    .eq('id', config.id)

  return { needed: true, maxId, cursor }
}

/**
 * Run one backfill batch (REQUESTS_PER_RUN short_id fetches + imports).
 * Returns progress. Safe to call repeatedly — checkpoint makes it resumable.
 */
export async function runBackfillBatch(): Promise<{ done: boolean; processed: number; imported: number; skipped: number; failed: number; failedIds?: number[]; cursor: number; maxId: number | null; error?: string }> {
  const startedAt = Date.now()
  const creds = await getApiKey()
  if (!creds) return { done: true, processed: 0, imported: 0, skipped: 0, failed: 0, cursor: 0, maxId: null, error: 'not configured' }

  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('easyorders_config')
    .select('id, store_id, backfill_status, backfill_cursor, backfill_max_id, backfill_imported, backfill_skipped, backfill_failed')
    .limit(1)
    .maybeSingle()
  if (!config) return { done: true, processed: 0, imported: 0, skipped: 0, failed: 0, cursor: 0, maxId: null, error: 'no config' }

  if (config.backfill_status === 'done') {
    return { done: true, processed: 0, imported: config.backfill_imported, skipped: config.backfill_skipped, failed: config.backfill_failed, cursor: config.backfill_cursor, maxId: config.backfill_max_id }
  }
  // Auto-start if idle with no max id yet
  let maxId = config.backfill_max_id
  if (config.backfill_status === 'idle' || !maxId) {
    const start = await startBackfill()
    maxId = start.maxId
  }

  const startCursor = config.backfill_cursor
  const endCursor = Math.min((maxId ?? startCursor) , startCursor + REQUESTS_PER_RUN)

  let imported = 0
  let skipped = 0
  let failed = 0
  let cursor = startCursor
  /** short_ids that failed in THIS batch — reported so a retry is possible. */
  const failedIds: number[] = []

  const pace = () => new Promise(r => setTimeout(r, REQUEST_PACE_MS))

  // Persist progress after EVERY item, not just at the end of the batch.
  // A batch can be interrupted by the serverless timeout; without a
  // per-item checkpoint the same short_ids are re-scanned on the next run
  // and double-counted in the progress counters.
  const checkpoint = async (
    nextCursor: number,
    counters: { imported: number; skipped: number; failed: number }
  ) => {
    try {
      await supabase
        .from('easyorders_config')
        .update({
          backfill_cursor: nextCursor,
          backfill_imported: counters.imported,
          backfill_skipped: counters.skipped,
          backfill_failed: counters.failed,
          backfill_status: nextCursor >= (maxId ?? nextCursor) ? 'done' : 'running',
          backfill_finished_at:
            nextCursor >= (maxId ?? nextCursor) ? new Date().toISOString() : null,
        })
        .eq('id', config.id)
    } catch (e) {
      // A checkpoint write must never abort the batch — the counters are
      // advisory, the cursor is re-derived from the next invocation.
      console.error('backfill checkpoint failed:', e)
    }
  }

  for (let sid = startCursor + 1; sid <= endCursor; sid++) {
    cursor = sid
    await pace()
    try {
      const res = await fetch(`${API_BASE}/orders/short/${sid}`, {
        headers: { 'Api-Key': creds.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 404) {
        // Hole in the sequence — normal. Count it as skipped so the
        // counters add up to the number of short_ids scanned.
        skipped++
        await checkpoint(cursor, { imported: config.backfill_imported + imported, skipped: config.backfill_skipped + skipped, failed: config.backfill_failed + failed })
        continue
      }
      if (res.status === 429) {
        // Rate limited → stop this batch, retry same cursor next invocation
        cursor = sid - 1
        break
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        // EasyOrders answers 400 "record not found" for a short_id that has
        // no order — a hole in the sequence, exactly like a 404. Counting it
        // as a failure was wrong; it is a skip.
        if (/record not found/i.test(body)) {
          skipped++
          await checkpoint(cursor, { imported: config.backfill_imported + imported, skipped: config.backfill_skipped + skipped, failed: config.backfill_failed + failed })
          continue
        }
        failed++
        failedIds.push(sid)
        // Record WHY — an HTTP-level failure was previously invisible in
        // `backfill_last_error` (only thrown errors were recorded), which
        // made a failing scan impossible to diagnose.
        await supabase
          .from('easyorders_config')
          .update({
            backfill_last_error: `short_id ${sid}: HTTP ${res.status} ${body.slice(0, 180)}`.slice(0, 300),
          })
          .eq('id', config.id)
        await checkpoint(cursor, { imported: config.backfill_imported + imported, skipped: config.backfill_skipped + skipped, failed: config.backfill_failed + failed })
        continue
      }

      const order = await res.json()

      // Only this store's orders. A payload without store_id is assumed to
      // belong to the configured store (it came from that store's API key)
      // — otherwise it would be inserted with a NULL store_id, which the
      // unique index cannot deduplicate.
      const payloadStoreId: string | null = order?.store_id ?? null
      if (payloadStoreId && config.store_id && payloadStoreId !== config.store_id) {
        skipped++
        await checkpoint(cursor, { imported: config.backfill_imported + imported, skipped: config.backfill_skipped + skipped, failed: config.backfill_failed + failed })
        continue
      }
      const effectiveStoreId = payloadStoreId ?? config.store_id
      const normalisedOrder = { ...order, store_id: effectiveStoreId }

      // Idempotent pre-check. The lookup MUST mirror the unique index
      // `idx_orders` (easyorders_order_id, easyorders_store_id) and its
      // errors MUST be surfaced — a swallowed read error used to let the
      // insert run and fail with a spurious 23505, inflating `failed`.
      const { data: existing, error: existingError } = await supabase
        .from('orders')
        .select('id')
        .eq('easyorders_order_id', normalisedOrder.id)
        .eq('easyorders_store_id', effectiveStoreId)
        .limit(1)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) {
        skipped++
        await checkpoint(cursor, { imported: config.backfill_imported + imported, skipped: config.backfill_skipped + skipped, failed: config.backfill_failed + failed })
        continue
      }

      // Import through the SAME pipeline as webhooks. The pipeline is
      // idempotent and reports what it actually did, so a duplicate that
      // slipped past the pre-check is counted as a skip, not a failure.
      const result = await easyOrdersSyncService.processWebhookEvent('order-created', normalisedOrder)
      if (result.outcome === 'created') {
        imported++
      } else if (result.outcome === 'skipped') {
        skipped++
      } else {
        failed++
      }
    } catch (e) {
      failed++
      failedIds.push(sid)
      const msg = e instanceof Error
        ? `${e.message}${e.cause ? ` [${String(e.cause).slice(0, 120)}]` : ''}`
        : typeof e === 'object' && e !== null ? JSON.stringify(e).slice(0, 250) : String(e)
      console.error(`backfill short_id ${sid} failed:`, e)
      await supabase
        .from('easyorders_config')
        .update({ backfill_last_error: `short_id ${sid}: ${msg}`.slice(0, 300) })
        .eq('id', config.id)
    }
    await checkpoint(cursor, { imported: config.backfill_imported + imported, skipped: config.backfill_skipped + skipped, failed: config.backfill_failed + failed })
  }

  const totalImported = config.backfill_imported + imported
  const totalSkipped = config.backfill_skipped + skipped
  const totalFailed = config.backfill_failed + failed
  const done = cursor >= (maxId ?? cursor)

  // Final write — the per-item checkpoints already persisted the same
  // values, so this only matters when the batch broke early (429) and the
  // cursor was rewound.
  await checkpoint(cursor, { imported: totalImported, skipped: totalSkipped, failed: totalFailed })

  // ONE sync-log row per scanner run (F-013).
  //
  // Before this, the scanners left no trace in `easyorders_sync_logs`: the
  // table stopped at 2026-11-06 while 2 022 orders were imported afterwards,
  // so the operator could not tell what the background import had done. The
  // row is written through the database function, which updates the counters
  // in the same transaction (F-012 — the old per-order read-modify-write lost
  // increments under concurrent workers).
  await recordEasyOrdersSyncRun(supabase, {
    syncType: 'backfill',
    status: 'success',
    processed: imported + skipped + failed,
    imported,
    updated: 0,
    skipped,
    failed,
    durationMs: Date.now() - startedAt,
    errors: failedIds.slice(0, 20).map((id) => ({ message: `short_id ${id} failed` })),
  })

  return {
    done,
    processed: imported + skipped + failed,
    imported,
    skipped,
    failed,
    failedIds,
    cursor,
    maxId,
  }
}
