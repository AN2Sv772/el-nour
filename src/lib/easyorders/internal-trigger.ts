import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Internal trigger secret for server-to-server self-calls.
 *
 * The queue processor, the backfill route and the webhook route all
 * re-invoke `/api/integrations/easyorders/process-queue` to keep the work
 * chain alive. That used to be done with a fixed `x-queue-trigger: webhook`
 * header, which meant ANY unauthenticated caller could:
 *   - drain the webhook queue at will,
 *   - trigger backfill scans that burn the EasyOrders API quota (40 req/min),
 *   - bypass the rate limiter for those paths.
 *
 * The header now carries an HMAC derived from a server-side secret that is
 * never exposed to the browser, so only this application can mint a valid
 * trigger. The comparison is timing-safe.
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is preferred because it is already deployed;
 * `INTERNAL_TRIGGER_SECRET` can be set as an explicit override.
 */
const TRIGGER_CONTEXT = 'easyorders-queue-trigger'

export function getInternalTriggerSecret(): string | null {
  const key = process.env.INTERNAL_TRIGGER_SECRET || process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!key || key.trim().length === 0) return null
  return createHmac('sha256', key).update(TRIGGER_CONTEXT).digest('hex')
}

/**
 * Validate a trigger header. Fails closed: when no server secret is
 * configured, no trigger is accepted — the chain simply stops instead of
 * leaving an open door.
 */
export function isValidInternalTrigger(received: string | null | undefined): boolean {
  const expected = getInternalTriggerSecret()
  if (!expected || !received) return false
  const expectedBuf = Buffer.from(expected, 'utf8')
  const receivedBuf = Buffer.from(received, 'utf8')
  if (expectedBuf.length !== receivedBuf.length) return false
  return timingSafeEqual(expectedBuf, receivedBuf)
}

/** Header name used for the internal trigger. */
export const INTERNAL_TRIGGER_HEADER = 'x-queue-trigger'

/**
 * The origin this server should call ITSELF on.
 *
 * NEVER derive the target of a secret-bearing self-call from the inbound
 * request: `request.url` is built from the `Host` header, and on a
 * deployment that trusts the host header an attacker can make the server
 * hand its internal trigger secret to a host of their choosing — and then
 * use that secret to drive the queue unauthenticated.
 *
 * `INTERNAL_ORIGIN` wins; `NEXT_PUBLIC_APP_URL` is the fallback. Only when
 * neither is configured do we fall back to the request origin, which is the
 * pre-existing behaviour.
 */
export function selfOrigin(requestOrigin: string): string {
  const configured = process.env.INTERNAL_ORIGIN || process.env.NEXT_PUBLIC_APP_URL
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // A malformed URL is not a reason to leak the secret — fall through.
    }
  }
  return requestOrigin
}
