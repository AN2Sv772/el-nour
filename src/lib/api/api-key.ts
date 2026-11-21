/**
 * API-key authentication for the read-only external API.
 *
 * WHY A SEPARATE KEY
 *
 * The dashboard's routes use the Supabase session (a logged-in employee).
 * The external API is for OTHER tools — a chat assistant, a spreadsheet, a
 * scheduled job — that need the business numbers without a browser session.
 * Those callers get a key, and the key grants READ access only.
 *
 * RULES
 *   - The key lives in the server environment only. It never reaches the
 *     browser and is never written to a log.
 *   - The comparison is timing-safe (a byte-by-byte compare would leak the
 *     key's prefix through response times).
 *   - With no key configured, the API answers 503 "not configured" — it does
 *     NOT fall open. An unconfigured key must never mean "open to everyone".
 */

import { timingSafeEqual } from 'node:crypto'

/** The environment variable that holds the key. */
export const API_KEY_ENV = 'REPORTS_API_KEY'

export type ApiKeyResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string }

/** Read the configured key from the environment. */
export function configuredApiKey(): string | null {
  const value = process.env[API_KEY_ENV]
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) {
    // Still burn a comparison so the timing does not reveal the length.
    timingSafeEqual(bufferA, bufferA)
    return false
  }
  return timingSafeEqual(bufferA, bufferB)
}

/** Extract the key from the request headers. */
export function extractApiKey(request: Request): string | null {
  const header = request.headers.get('x-api-key')
  if (header && header.trim()) return header.trim()

  const authorization = request.headers.get('authorization')
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i)
    if (match && match[1].trim()) return match[1].trim()
  }

  return null
}

/**
 * Verify the request's API key.
 *
 * Returns a discriminated result so the caller can answer 401 (wrong key) or
 * 503 (no key configured) — never silently allowing the request through.
 */
export function verifyApiKey(request: Request): ApiKeyResult {
  const expected = configuredApiKey()
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: `الواجهة الخارجية غير مُفعّلة — عيّن المتغير ${API_KEY_ENV} على الخادم أولاً.`,
    }
  }

  const provided = extractApiKey(request)
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: 'مفتاح الـ API مطلوب — أرسله في الترويسة x-api-key.',
    }
  }

  if (!safeEqual(provided, expected)) {
    return { ok: false, status: 401, error: 'مفتاح الـ API غير صحيح.' }
  }

  return { ok: true }
}
