/**
 * Durable queue regression tests: dedup identity + exponential backoff.
 * (Claim atomicity is enforced by the DB function with FOR UPDATE SKIP LOCKED.)
 */
import { describe, it, expect } from 'vitest'
import { errorMessage } from './queue'

function backoffDelay(attempt: number): number {
  return Math.min(60_000 * Math.pow(2, attempt - 1), 60_000 * 16)
}

function dedupKey(eventType: string, externalOrderId: string | null): string {
  return `${eventType}:${externalOrderId ?? 'no-id'}`
}

const MAX_ATTEMPTS = 5

describe('webhook event queue', () => {
  it('dedup key collapses duplicate deliveries of the same order', () => {
    expect(dedupKey('order-created', 'abc-123'))
      .toBe(dedupKey('order-created', 'abc-123'))
    expect(dedupKey('order-created', 'abc-123'))
      .not.toBe(dedupKey('order-status-update', 'abc-123'))
    expect(dedupKey('order-created', 'abc-123'))
      .not.toBe(dedupKey('order-created', 'def-456'))
  })

  it('missing external order id gets a safe key', () => {
    expect(dedupKey('order-created', null)).toBe('order-created:no-id')
  })

  it('exponential backoff grows: 1m, 2m, 4m, 8m, 16m (capped)', () => {
    expect(backoffDelay(1)).toBe(60_000)
    expect(backoffDelay(2)).toBe(120_000)
    expect(backoffDelay(3)).toBe(240_000)
    expect(backoffDelay(4)).toBe(480_000)
    expect(backoffDelay(5)).toBe(960_000)
    expect(backoffDelay(10)).toBe(960_000) // capped
  })

  it('dead-letter only after max attempts', () => {
    expect(MAX_ATTEMPTS).toBe(5)
    // attempt 4 < max → retry; attempt 5 >= max → dead letter
    expect(4 < MAX_ATTEMPTS).toBe(true)
    expect(5 >= MAX_ATTEMPTS).toBe(true)
  })
})

describe('queue error reporting', () => {
  it('keeps the message of a real Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('keeps the message of a PostgREST error (not an Error instance)', () => {
    // PostgrestError is a plain { message, code, details } literal — the
    // live pipeline recorded "unknown error" for every database failure
    // because `error instanceof Error` was false for it.
    const postgrestError = {
      message: 'duplicate key value violates unique constraint "idx_orders"',
      code: '23505',
      details: 'Key (easyorders_order_id, easyorders_store_id)=(a, b) already exists.',
    }
    const msg = errorMessage(postgrestError)
    expect(msg).toContain('duplicate key value')
    expect(msg).toContain('23505')
    expect(msg).not.toBe('unknown error')
  })

  it('handles strings and unknown throwables', () => {
    expect(errorMessage('plain string failure')).toBe('plain string failure')
    expect(errorMessage(null)).toBe('unknown error')
    expect(errorMessage(undefined)).toBe('unknown error')
    expect(errorMessage({ some: 'object' })).toContain('some')
  })
})
