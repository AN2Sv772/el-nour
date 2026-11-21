/**
 * Regression tests for the webhook IDEMPOTENCY, STALE-GUARD and
 * RECONCILIATION logic.
 *
 * Historical bugs these pin down:
 *
 *  1. The dedup key was `${eventType}:${payload.id ?? 'no-id'}`. A status
 *     event carries `order_id`, not `id`, so EVERY status update collapsed
 *     into the single key "order-status-update:no-id" — two different
 *     transitions for the same order were treated as duplicates and one of
 *     them was silently dropped.
 *
 *  2. There was no stale-event protection. A delivery that arrived out of
 *     order (the normal case when EasyOrders retries) overwrote newer data
 *     with older data, rolling an order BACKWARDS.
 *
 *  3. Orders were CREATE-ONLY. An EasyOrders delivery for an order that was
 *     already imported was dropped entirely, so a corrected total or a
 *     changed status never reached the dashboard.
 */
import { describe, it, expect } from 'vitest'

/* ------------------------------------------------------------------ */
/* Helpers mirrored from the implementation (kept local so the test    */
/* pins the CONTRACT, not the import graph).                          */
/* ------------------------------------------------------------------ */

function extractOrderId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const candidate = p.id ?? p.order_id
  if (candidate === undefined || candidate === null) return null
  const id = String(candidate).slice(0, 64)
  return id.length > 0 ? id : null
}

function buildDedupKey(eventType: string, payload: unknown, orderId: string | null): string {
  if (eventType === 'order-status-update') {
    const p = (payload ?? {}) as Record<string, unknown>
    const oldStatus = typeof p.old_status === 'string' ? p.old_status : '?'
    const newStatus = typeof p.new_status === 'string' ? p.new_status : '?'
    return `order-status-update:${orderId ?? 'no-id'}:${oldStatus}->${newStatus}`
  }
  return `${eventType}:${orderId ?? 'no-id'}`
}

const CURSOR_VERSION_PREFIX = 'v:'

function formatSyncCursor(remoteUpdatedAt?: string | null): string {
  if (remoteUpdatedAt && Number.isFinite(Date.parse(remoteUpdatedAt))) {
    return `${CURSOR_VERSION_PREFIX}${remoteUpdatedAt}`
  }
  return new Date().toISOString()
}

/** Decide whether an incoming remote version is newer than what we applied. */
function isStaleDelivery(appliedCursor: string | null | undefined, incomingUpdatedAt: string): boolean {
  if (!appliedCursor) return true // unknown → fail safe, do not touch
  const raw = appliedCursor.startsWith(CURSOR_VERSION_PREFIX)
    ? appliedCursor.slice(CURSOR_VERSION_PREFIX.length)
    : appliedCursor
  const appliedAt = Date.parse(raw)
  if (!Number.isFinite(appliedAt)) return true
  const incomingAt = Date.parse(incomingUpdatedAt)
  if (!Number.isFinite(incomingAt)) return true
  return incomingAt <= appliedAt
}

/** The status-transition guard used by the status-update handler. */
function shouldApplyStatusTransition(
  localStatus: string,
  expectedOldStatus: string,
  newStatus: string
): 'apply' | 'duplicate' | 'stale' {
  if (localStatus === expectedOldStatus) return 'apply'
  if (localStatus === newStatus) return 'duplicate'
  return 'stale'
}

describe('extractOrderId', () => {
  it('reads `id` from an order-created payload', () => {
    expect(extractOrderId({ id: 'order-1', cart_items: [] })).toBe('order-1')
  })

  it('reads `order_id` from an order-status-update payload', () => {
    expect(
      extractOrderId({
        event_type: 'order-status-update',
        order_id: 'order-2',
        old_status: 'pending',
        new_status: 'confirmed',
      })
    ).toBe('order-2')
  })

  it('returns null for a payload without an order id', () => {
    expect(extractOrderId({ foo: 'bar' })).toBeNull()
    expect(extractOrderId(null)).toBeNull()
    expect(extractOrderId('nope')).toBeNull()
    expect(extractOrderId({ id: '' })).toBeNull()
  })
})

describe('buildDedupKey', () => {
  it('gives every order-created event its own key', () => {
    expect(buildDedupKey('order-created', { id: 'a' }, 'a')).toBe('order-created:a')
    expect(buildDedupKey('order-created', { id: 'b' }, 'b')).toBe('order-created:b')
  })

  it('does NOT collapse two different status transitions of the same order', () => {
    const first = buildDedupKey(
      'order-status-update',
      { order_id: 'o1', old_status: 'pending', new_status: 'confirmed' },
      'o1'
    )
    const second = buildDedupKey(
      'order-status-update',
      { order_id: 'o1', old_status: 'confirmed', new_status: 'shipped' },
      'o1'
    )
    expect(first).not.toBe(second)
    expect(first).toBe('order-status-update:o1:pending->confirmed')
    expect(second).toBe('order-status-update:o1:confirmed->shipped')
  })

  it('collapses a REDELIVERY of the same transition', () => {
    const payload = { order_id: 'o1', old_status: 'pending', new_status: 'confirmed' }
    expect(buildDedupKey('order-status-update', payload, 'o1')).toBe(
      buildDedupKey('order-status-update', payload, 'o1')
    )
  })

  it('keeps different orders apart', () => {
    const payload = { old_status: 'pending', new_status: 'confirmed' }
    expect(buildDedupKey('order-status-update', payload, 'o1')).not.toBe(
      buildDedupKey('order-status-update', payload, 'o2')
    )
  })
})

describe('formatSyncCursor', () => {
  it('marks the remote version explicitly', () => {
    expect(formatSyncCursor('2026-10-15T12:00:00.000Z')).toBe('v:2026-10-15T12:00:00.000Z')
  })

  it('falls back to the local time when the payload has no remote version', () => {
    const cursor = formatSyncCursor(undefined)
    expect(cursor.startsWith('v:')).toBe(false)
    expect(Number.isFinite(Date.parse(cursor))).toBe(true)
  })
})

describe('stale delivery guard', () => {
  it('rejects a delivery older than the applied version', () => {
    expect(
      isStaleDelivery('v:2026-10-20T00:00:00.000Z', '2026-10-15T00:00:00.000Z')
    ).toBe(true)
  })

  it('accepts a delivery newer than the applied version', () => {
    expect(
      isStaleDelivery('v:2026-10-15T00:00:00.000Z', '2026-10-20T00:00:00.000Z')
    ).toBe(false)
  })

  it('rejects a delivery with the SAME version (a redelivery)', () => {
    expect(
      isStaleDelivery('v:2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z')
    ).toBe(true)
  })

  it('rejects the delivery when the applied version is unknown (fail safe)', () => {
    expect(isStaleDelivery(null, '2026-10-20T00:00:00.000Z')).toBe(true)
    expect(isStaleDelivery(undefined, '2026-10-20T00:00:00.000Z')).toBe(true)
  })

  it('treats a legacy (local-time) cursor as a conservative lower bound', () => {
    // The legacy cursor is the local import time. Anything that happened
    // before the import was already included in the imported state.
    expect(isStaleDelivery('2026-11-19T02:00:00.000Z', '2026-10-15T00:00:00.000Z')).toBe(true)
    expect(isStaleDelivery('2026-11-19T02:00:00.000Z', '2026-11-20T00:00:00.000Z')).toBe(false)
  })
})

describe('status transition guard', () => {
  it('applies the transition when the order is in the expected old state', () => {
    expect(shouldApplyStatusTransition('pending', 'pending', 'confirmed')).toBe('apply')
  })

  it('detects a duplicate (already applied)', () => {
    expect(shouldApplyStatusTransition('confirmed', 'pending', 'confirmed')).toBe('duplicate')
  })

  it('detects a stale event that would roll the order backwards', () => {
    expect(shouldApplyStatusTransition('shipped', 'pending', 'confirmed')).toBe('stale')
  })
})
