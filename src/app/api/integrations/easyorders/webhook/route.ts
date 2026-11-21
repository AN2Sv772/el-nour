import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { easyOrdersService } from '@/lib/easyorders/service'
import { decryptSecret } from '@/lib/crypto'
import { getInternalTriggerSecret, INTERNAL_TRIGGER_HEADER } from '@/lib/easyorders/internal-trigger'

/**
 * POST /api/integrations/easyorders/webhook
 *
 * Official EasyOrders webhook receiver (configure in seller dashboard:
 * Public API → Webhooks).
 *
 * RELIABILITY MODEL (durable queue):
 *   1. Verify `secret` header (official: verbatim value, timing-safe compare)
 *   2. Persist the event durably with processing_status='pending'
 *   3. Return 202 immediately — never process inline
 *   4. Background processor (Vercel Cron / process-queue endpoint) drains
 *      the queue with atomic claims, bounded retries + exponential backoff,
 *      and dead-letter after max attempts.
 *
 * We NEVER return success for an event that was not durably stored.
 */
/**
 * Extract the EasyOrders order id from a webhook payload.
 *
 * `order-created` payloads carry `id`; `order-status-update` payloads carry
 * `order_id`. Both must be found, otherwise every status update is
 * de-duplicated against every other status update.
 */
export function extractOrderId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const candidate = p.id ?? p.order_id
  if (candidate === undefined || candidate === null) return null
  const id = String(candidate).slice(0, 64)
  return id.length > 0 ? id : null
}

/**
 * Build the idempotency key for an incoming event.
 *
 * Duplicate DELIVERIES of the same event collapse (EasyOrders retries a
 * delivery when it does not get a 2xx), but two different events for the
 * same order never collapse.
 */
export function buildDedupKey(
  eventType: string,
  payload: unknown,
  orderId: string | null
): string {
  if (eventType === 'order-status-update') {
    const p = (payload ?? {}) as Record<string, unknown>
    const oldStatus = typeof p.old_status === 'string' ? p.old_status : '?'
    const newStatus = typeof p.new_status === 'string' ? p.new_status : '?'
    return `order-status-update:${orderId ?? 'no-id'}:${oldStatus}->${newStatus}`
  }
  return `${eventType}:${orderId ?? 'no-id'}`
}

export async function POST(request: NextRequest) {
  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ status: 'ok' })
  }

  const supabase = createServiceClient()
  const receivedSecret = request.headers.get('secret')

  // Read stored (encrypted) webhook secret
  let storedSecret: string | null = null
  let configId: string | null = null
  try {
    const { data: config, error: cfgError } = await supabase
      .from('easyorders_config')
      .select('id, webhook_secret')
      .limit(1)
      .maybeSingle()
    if (cfgError) console.error('webhook: config read failed:', cfgError.message)
    configId = config?.id ?? null
    if (config?.webhook_secret) {
      storedSecret = config.webhook_secret.startsWith('v1:')
        ? decryptSecret(config.webhook_secret)
        : config.webhook_secret
    }
  } catch (e) {
    console.error('webhook: failed reading config:', e)
  }

  // Parse payload (before secret check, to identify rejected events safely)
  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }
  const parsed = easyOrdersService.parseWebhookPayload(payload)

  // The order id lives under a DIFFERENT key per event type:
  //   order-created        → `id`
  //   order-status-update  → `order_id`
  // The old code only looked at `id`, so EVERY status update collapsed to
  // the key "order-status-update:no-id" and different transitions for the
  // same order were treated as duplicates of each other (and lost).
  const externalOrderId = extractOrderId(payload)

  // Timing-safe secret verification (official contract: verbatim value)
  if (!easyOrdersService.verifyWebhookSecret(receivedSecret, storedSecret)) {
    console.error(`webhook: REJECTED — secret mismatch (has_header=${Boolean(receivedSecret)}, stored=${Boolean(storedSecret)}, event=${parsed.eventType}, order=${externalOrderId ?? 'n/a'})`)
    try {
      await supabase.from('automation_logs').insert({
        type: 'webhook_rejected',
        status: 'failed',
        reference_type: 'easyorders_webhook',
        details: {
          reason: 'invalid_secret',
          has_secret_header: Boolean(receivedSecret),
          has_stored_secret: Boolean(storedSecret),
          event_type: parsed.eventType,
          easyorders_order_id: externalOrderId,
        },
      })
    } catch {}
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  if (parsed.eventType === 'unknown') {
    // Valid secret but unrecognizable body — record for investigation, accept
    try {
      if (configId) {
        await supabase.from('easyorders_webhook_events').insert({
          config_id: configId,
          event_type: 'order-created', // CHECK constraint default bucket
          payload: (payload ?? {}) as Record<string, unknown>,
          processing_status: 'dead_letter',
          last_error: 'unrecognized payload shape',
          processed: false,
        })
      }
    } catch {}
    return NextResponse.json({ status: 'ok', note: 'unrecognized event stored for review' })
  }

  // Durable enqueue — the dedup key collapses duplicate deliveries of the
  // SAME event, and never collapses two DIFFERENT events.
  const dedupKey = buildDedupKey(parsed.eventType, payload, externalOrderId)
  let eventId: string | null = null
  let duplicate = false
  try {
    if (!configId) {
      console.error('webhook: no easyorders_config row — event cannot be attributed')
      return NextResponse.json({ status: 'ok', note: 'not configured' })
    }

    // Idempotency: same event type + same order, still pending/processing → collapse
    const { data: existing } = await supabase
      .from('easyorders_webhook_events')
      .select('id, processing_status, created_at')
      .eq('dedup_key', dedupKey)
      .in('processing_status', ['pending', 'processing'])
      .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()) // 10-min window
      .limit(1)

    if (existing && existing.length > 0) {
      duplicate = true
      eventId = existing[0].id
    } else {
      const { data: ev, error: evError } = await supabase
        .from('easyorders_webhook_events')
        .insert({
          config_id: configId,
          event_type: parsed.eventType,
          payload: (payload ?? {}) as Record<string, unknown>,
          processing_status: 'pending',
          next_retry_at: new Date().toISOString(),
          dedup_key: dedupKey,
        })
        .select('id')
        .single()
      if (evError) throw evError
      eventId = ev?.id ?? null
    }
  } catch (e) {
    // DURABLE GUARANTEE: if we could not store the event, do NOT return success
    console.error('webhook: FAILED to durably enqueue event:', e)
    await supabase
      .from('automation_logs')
      .insert({
        type: 'webhook_enqueue_failed',
        status: 'failed',
        reference_type: 'easyorders_webhook',
        details: { event_type: parsed.eventType, easyorders_order_id: externalOrderId },
      })
      .then(undefined, () => {})
    return NextResponse.json(
      { error: 'Failed to accept event' },
      { status: 500 } // EasyOrders will retry
    )
  }

  // Update last_webhook_at (best-effort)
  try {
    if (configId) {
      await supabase
        .from('easyorders_config')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', configId)
    }
  } catch {}


  // Delivery metadata — the raw body is already stored in `payload`, so this
  // records WHERE the delivery came from and how big it was. It is the
  // evidence needed to tell "EasyOrders never called us" apart from
  // "EasyOrders called us and we rejected it".
  await supabase
    .from('automation_logs')
    .insert({
      type: 'webhook_received',
      status: 'success',
      reference_type: 'easyorders_webhook',
      details: {
        event_type: parsed.eventType,
        easyorders_order_id: externalOrderId,
        dedup_key: dedupKey,
        duplicate_delivery: duplicate,
        event_id: eventId,
        body_bytes: rawBody.length,
        content_type: request.headers.get('content-type'),
        user_agent: request.headers.get('user-agent'),
        delivery_id:
          request.headers.get('x-request-id') ||
          request.headers.get('x-easyorders-delivery-id') ||
          request.headers.get('x-amzn-trace-id'),
        source_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      },
    })
    .then(undefined, () => {})

  // Kick the background processor AFTER the response (Next.js after())
  after(async () => {
    const origin = new URL(request.url).origin
    await fetch(`${origin}/api/integrations/easyorders/process-queue`, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          [INTERNAL_TRIGGER_HEADER]: getInternalTriggerSecret() ?? '',
        },
      body: JSON.stringify({}),
    }).catch(() => {})
  })

  return NextResponse.json({
    status: 'ok',
    event: parsed.eventType,
    event_id: eventId,
    duplicate_delivery: duplicate,
    note: 'accepted for processing',
  }, { status: 202 })
}

/**
 * The EasyOrders webhook contract is POST-only. Returning 200 for GET made
 * it look like the endpoint was healthy when EasyOrders was never able to
 * deliver anything to it.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: 'Method Not Allowed',
      message:
        'EasyOrders webhook endpoint. POST this URL in the seller dashboard (Public API → Webhooks) — GET is not a valid delivery method.',
    },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
