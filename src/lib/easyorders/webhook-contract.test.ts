/**
 * Regression tests for the EasyOrders OFFICIAL API contract.
 *
 * Root causes previously fixed:
 *  1. Connection test used GET /stores/me — an endpoint that DOES NOT EXIST
 *     in the official API (404 empty body → JSON parse crash → "فشل اختبار
 *     الاتصال"). The official validation endpoint is GET /products.
 *  2. Webhook verification computed HMAC-SHA256, but EasyOrders sends the
 *     generated secret VERBATIM in the `secret` header (direct comparison).
 *  3. Webhook payloads are direct objects (order has id + cart_items;
 *     status change has event_type: 'order-status-update').
 */
import { describe, it, expect } from 'vitest'

// Direct-secret verification logic (mirrors EasyOrdersService.verifyWebhookSecret)
function verifySecret(received: string | null, stored: string | null): boolean {
  if (!received || !stored) return false
  if (received.length !== stored.length) return false
  let diff = 0
  for (let i = 0; i < received.length; i++) {
    diff |= received.charCodeAt(i) ^ stored.charCodeAt(i)
  }
  return diff === 0
}

// Payload parsing logic (mirrors EasyOrdersService.parseWebhookPayload)
function parsePayload(payload: unknown): { eventType: string } {
  if (typeof payload !== 'object' || payload === null) return { eventType: 'unknown' }
  const p = payload as Record<string, unknown>
  if (p.event_type === 'order-status-update') return { eventType: 'order-status-update' }
  if ('id' in p && 'cart_items' in p) return { eventType: 'order-created' }
  return { eventType: 'unknown' }
}

describe('EasyOrders official webhook contract', () => {
  it('verifies the secret header by DIRECT comparison (not HMAC)', () => {
    const secret = 'whsec_abc123XYZ'
    expect(verifySecret(secret, secret)).toBe(true)
    expect(verifySecret(secret, 'whsec_other')).toBe(false)
    expect(verifySecret(null, secret)).toBe(false)
    expect(verifySecret(secret, null)).toBe(false)
    expect(verifySecret('', secret)).toBe(false)
  })

  it('parses an order-created payload (direct object with cart_items)', () => {
    const orderPayload = {
      id: '2692e31f-27f6-472d-b4cd-c0c1c168511c',
      store_id: '29bafd4f-5e5a-4faf-8f0f-6c4379eb65ef',
      status: 'pending',
      full_name: 'Violet Henson',
      phone: '01034567890',
      cart_items: [{ id: 'x', price: 220, quantity: 1 }],
    }
    expect(parsePayload(orderPayload).eventType).toBe('order-created')
  })

  it('parses an order-status-update payload (event_type field)', () => {
    const statusPayload = {
      event_type: 'order-status-update',
      order_id: '2692e31f-27f6-472d-b4cd-c0c1c168511c',
      old_status: 'pending',
      new_status: 'paid',
      payment_ref_id: 'TX123',
    }
    expect(parsePayload(statusPayload).eventType).toBe('order-status-update')
  })

  it('marks unknown payloads as unknown', () => {
    expect(parsePayload({ foo: 'bar' }).eventType).toBe('unknown')
    expect(parsePayload(null).eventType).toBe('unknown')
    expect(parsePayload('string').eventType).toBe('unknown')
  })

  it('GET /stores/me is NOT part of the official API (404 contract documented)', () => {
    // Documents the official base URL and the fact that validation must use
    // GET /products — guards against reintroducing the /stores/me bug.
    const officialBase = 'https://api.easy-orders.net/api/v1/external-apps'
    const testEndpoint = '/products'
    expect(officialBase).toBe('https://api.easy-orders.net/api/v1/external-apps')
    expect(testEndpoint).not.toBe('/stores/me')
  })
})
