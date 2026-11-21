import { createServiceClient } from '@/lib/supabase/service'
import type {
  EasyOrdersConfig,
  EasyOrdersOrder,
  EasyOrdersWebhookPayload,
  EasyOrdersStatusChangePayload,
} from '@/types'
import { decryptSecret } from '@/lib/crypto'
import { timingSafeEqual } from 'crypto'

/**
 * EasyOrders Public API client.
 *
 * OFFICIAL CONTRACT (https://public-api-docs.easy-orders.net):
 *  - Base URL: https://api.easy-orders.net/api/v1/external-apps
 *  - Auth header:  Api-Key: <key>
 *  - GET /products            → direct JSON array (no {data} wrapper, no meta)
 *  - GET /orders/:order_id    → direct JSON object (requires orders:read permission)
 *  - GET /orders list         → DOES NOT EXIST (404) — orders arrive via webhooks
 *  - Webhooks: POST with header `secret: <generated secret>` (plain value,
 *    NOT an HMAC signature) and the payload as the body.
 */

export const EASYORDERS_API_BASE = 'https://api.easy-orders.net/api/v1/external-apps'

export interface EasyOrdersProduct {
  id: string
  store_id: string
  name: string
  price: number
  slug?: string
  sku?: string | null
}

/**
 * The accepted webhook secrets, as a list.
 *
 * EasyOrders generates ONE secret PER webhook, and a store commonly needs
 * more than one webhook (one for `orders`, one for `order-status-update`).
 * The dashboard column holds a single value, so several secrets are stored
 * as a JSON array — a plain secret still works unchanged.
 *
 * Accepted formats:
 *   "secret"                       -> one secret
 *   '["a","b"]'                    -> JSON array
 *   "a,b" / "a\nb"                -> separated list
 */
export function parseAcceptedWebhookSecrets(stored: string): string[] {
  const raw = stored.trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // A valid array is authoritative — even an EMPTY one means "no
        // secret accepted", not a literal "[]" secret.
        return parsed
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      }
    } catch {
      /* not JSON — fall through to the separator split */
    }
  }
  return raw
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export class EasyOrdersService {
  private config: EasyOrdersConfig | null = null
  private baseUrl = EASYORDERS_API_BASE

  async initialize(): Promise<void> {
    const supabase = createServiceClient()
    const { data } = await supabase.from('easyorders_config').select('*').maybeSingle()
    if (data) {
      // Decrypt API key (stored encrypted at rest)
      let apiKey = data.api_key
      if (apiKey && apiKey.startsWith('v1:')) {
        try {
          apiKey = decryptSecret(apiKey)
        } catch {
          console.error('Failed to decrypt EasyOrders API key')
          apiKey = ''
        }
      }
      let webhookSecret = data.webhook_secret
      if (webhookSecret && webhookSecret.startsWith('v1:')) {
        try {
          webhookSecret = decryptSecret(webhookSecret)
        } catch {
          webhookSecret = ''
        }
      }
      this.config = {
        ...data,
        api_key: apiKey,
        webhook_secret: webhookSecret,
      } as EasyOrdersConfig
    }
  }

  private async getConfig(): Promise<EasyOrdersConfig> {
    if (!this.config) {
      await this.initialize()
    }
    if (!this.config) {
      throw new Error('EasyOrders configuration not found')
    }
    return this.config
  }

  /**
   * Raw authenticated request. Returns the parsed JSON body as-is —
   * EasyOrders returns direct arrays/objects, NOT a {data} wrapper.
   */
  private async requestRaw<T>(endpoint: string, options: RequestInit = {}, timeoutMs = 15000): Promise<{ status: number; body: T | null; rawText: string }> {
    const config = await this.getConfig()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Api-Key': config.api_key,
          'Accept': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      })

      const rawText = await response.text()
      let body: T | null = null
      if (rawText) {
        try {
          body = JSON.parse(rawText) as T
        } catch {
          body = null // non-JSON body (e.g. empty 404) — surfaced via status
        }
      }
      return { status: response.status, body, rawText }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Authenticated request that throws descriptive Arabic errors on failure. */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { status, body, rawText } = await this.requestRaw<T>(endpoint, options)

    if (status === 401 || status === 403) {
      throw new Error('مفتاح API غير مصرح به. تحقق من المفتاح وصلاحياته في لوحة EasyOrders.')
    }
    if (status === 404) {
      throw new Error(`Endpoint غير موجود في EasyOrders API: ${endpoint}`)
    }
    if (status === 429) {
      throw new Error('تم تجاوز الحد المسموح من الطلبات. حاول بعد قليل.')
    }
    if (status >= 500) {
      throw new Error('خطأ في خوادم EasyOrders. حاول مرة أخرى لاحقاً.')
    }
    if (status < 200 || status >= 300) {
      const apiMsg = (body as { message?: string; error?: string } | null)?.message
        || (body as { error?: string } | null)?.error
        || rawText.slice(0, 200)
      throw new Error(apiMsg || `EasyOrders API error: ${status}`)
    }
    if (body === null) {
      throw new Error('استجابة غير صالحة من EasyOrders API')
    }
    return body
  }

  /**
   * Test the connection using an endpoint that actually exists (official docs):
   * GET /products → direct array. The store_id is taken from the first product.
   * This is also the moment the key's products:read permission is proven.
   */
  async testConnection(): Promise<{ success: boolean; store?: { id: string; name: string | null }; error?: string }> {
    const config = await this.getConfig()
    return this.testConnectionWithKey(config.api_key)
  }

  /** Same as testConnection but with an explicit key (test-before-save flow). */
  async testConnectionWithKey(apiKey: string): Promise<{ success: boolean; store?: { id: string; name: string | null }; error?: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(`${this.baseUrl}/products`, {
        method: 'GET',
        headers: {
          'Api-Key': apiKey,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      })

      const rawText = await response.text()

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: 'مفتاح API مرفوض من EasyOrders. تحقق من صحة المفتاح في لوحة البائع (Public API).' }
      }
      if (response.status === 429) {
        return { success: false, error: 'تم تجاوز الحد المسموح من الطلبات (Rate Limit). انتظر قليلاً ثم أعد المحاولة.' }
      }
      if (!response.ok) {
        // 404 and others — surface the status clearly instead of crashing on empty body
        let apiMsg = ''
        if (rawText) {
          try {
            const parsed = JSON.parse(rawText)
            apiMsg = parsed?.message || parsed?.error || ''
          } catch { /* non-JSON */ }
        }
        return { success: false, error: apiMsg || `EasyOrders API أرجعت الخطأ ${response.status}` }
      }

      let products: EasyOrdersProduct[] = []
      try {
        const parsed = JSON.parse(rawText)
        products = Array.isArray(parsed) ? parsed : []
      } catch {
        return { success: false, error: 'استجابة غير صالحة (ليست JSON) من EasyOrders' }
      }

      const storeId = products[0]?.store_id || null
      return { success: true, store: { id: storeId ?? '', name: null } }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'انتهت مهلة الاتصال بخوادم EasyOrders. أعد المحاولة.' }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'فشل الاتصال بـ EasyOrders',
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Fetch a single order by its EasyOrders id (official: GET /orders/:id). */
  async getOrderById(orderId: string): Promise<EasyOrdersOrder | null> {
    try {
      return await this.request<EasyOrdersOrder>(`/orders/${orderId}`)
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) return null
      throw error
    }
  }

  /**
   * Verify the webhook `secret` header.
   * OFFICIAL: EasyOrders sends the generated secret verbatim in the `secret`
   * header — it is NOT an HMAC signature. Use a timing-safe direct comparison.
   */
  verifyWebhookSecret(receivedSecret: string | null, storedSecret: string | null): boolean {
    if (!receivedSecret || !storedSecret) return false
    const candidates = parseAcceptedWebhookSecrets(storedSecret)
    if (candidates.length === 0) return false
    // Every candidate is compared (no early exit) so the comparison time does
    // not reveal WHICH candidate matched.
    let matched = false
    for (const candidate of candidates) {
      const a = Buffer.from(receivedSecret)
      const b = Buffer.from(candidate)
      if (a.length !== b.length) continue
      if (timingSafeEqual(a, b)) matched = true
    }
    return matched
  }

  /**
   * Parse a webhook payload.
   *  - Order created: direct order object containing `cart_items`
   *  - Status change: object with `event_type: 'order-status-update'`
   * (Alias kept for queue processor readability.)
   */
  parseEvent(payload: unknown): { eventType: 'order-created' | 'order-status-update' | 'unknown'; data: unknown } {
    return this.parseWebhookPayload(payload)
  }

  parseWebhookPayload(payload: unknown): { eventType: 'order-created' | 'order-status-update' | 'unknown'; data: unknown } {
    if (typeof payload !== 'object' || payload === null) {
      return { eventType: 'unknown', data: payload }
    }
    const p = payload as Record<string, unknown>
    if (p.event_type === 'order-status-update') {
      return { eventType: 'order-status-update', data: payload as EasyOrdersStatusChangePayload }
    }
    if ('id' in p && 'cart_items' in p) {
      return { eventType: 'order-created', data: payload as EasyOrdersWebhookPayload }
    }
    return { eventType: 'unknown', data: payload }
  }
}

// Singleton instance
export const easyOrdersService = new EasyOrdersService()
