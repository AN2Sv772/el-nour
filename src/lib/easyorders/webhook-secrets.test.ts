/**
 * Regression tests for the accepted-webhook-secret list.
 *
 * EasyOrders generates ONE secret PER webhook, and a store normally needs
 * two: one for `orders` and one for `order-status-update`. The dashboard
 * column holds a single value, so several secrets are stored as a JSON
 * array — and a plain secret must keep working unchanged.
 */
import { describe, it, expect } from 'vitest'
import { parseAcceptedWebhookSecrets } from './service'
import { easyOrdersService } from './service'

describe('parseAcceptedWebhookSecrets', () => {
  it('treats a plain secret as a one-element list', () => {
    expect(parseAcceptedWebhookSecrets('abc123')).toEqual(['abc123'])
  })

  it('reads a JSON array of secrets', () => {
    expect(parseAcceptedWebhookSecrets('["one","two"]')).toEqual(['one', 'two'])
  })

  it('reads a comma or newline separated list', () => {
    expect(parseAcceptedWebhookSecrets('one,two')).toEqual(['one', 'two'])
    expect(parseAcceptedWebhookSecrets('one\ntwo')).toEqual(['one', 'two'])
  })

  it('ignores empty entries', () => {
    expect(parseAcceptedWebhookSecrets('  ')).toEqual([])
    expect(parseAcceptedWebhookSecrets('one,,two')).toEqual(['one', 'two'])
    expect(parseAcceptedWebhookSecrets('[]')).toEqual([])
  })

  it('falls back to the separator split when the JSON is broken', () => {
    // Not valid JSON -> the separator split applies, which also splits the
    // comma inside the broken value. A broken value must never match a
    // real secret, and this one cannot.
    expect(parseAcceptedWebhookSecrets('["broken",one')).toEqual(['["broken"', 'one'])
  })

  it('trims surrounding whitespace', () => {
    expect(parseAcceptedWebhookSecrets('  spaced  ')).toEqual(['spaced'])
  })
})

describe('verifyWebhookSecret with multiple accepted secrets', () => {
  const verify = (received: string | null, stored: string | null) =>
    easyOrdersService.verifyWebhookSecret(received, stored)

  it('accepts a plain stored secret', () => {
    expect(verify('secret-a', 'secret-a')).toBe(true)
    expect(verify('secret-b', 'secret-a')).toBe(false)
  })

  it('accepts either secret of a JSON array', () => {
    const stored = '["secret-a","secret-b"]'
    expect(verify('secret-a', stored)).toBe(true)
    expect(verify('secret-b', stored)).toBe(true)
    expect(verify('secret-c', stored)).toBe(false)
  })

  it('accepts either secret of a separated list', () => {
    const stored = 'secret-a,secret-b'
    expect(verify('secret-a', stored)).toBe(true)
    expect(verify('secret-b', stored)).toBe(true)
    expect(verify('secret-c', stored)).toBe(false)
  })

  it('rejects a missing header or a missing stored value', () => {
    expect(verify(null, 'secret-a')).toBe(false)
    expect(verify('secret-a', null)).toBe(false)
    expect(verify('', '')).toBe(false)
  })
})
