import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * GET /api/integrations/easyorders
 * Returns EasyOrders config WITHOUT the raw API key (masked only).
 */
export async function GET() {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('easyorders_config')
      .select('id, store_id, store_name, is_connected, last_sync_at, last_sync_status, last_sync_error, last_webhook_at, total_imported_orders, total_updated_orders, total_skipped_orders, sync_cursor, created_at, updated_at')
      .limit(1)
      .maybeSingle()

    if (error) throw error

    // Get masked API key
    let apiKeyMasked: string | null = null
    let hasApiKey = false
    if (data) {
      const { data: keyData } = await supabase
        .from('easyorders_config')
        .select('api_key')
        .limit(1)
        .maybeSingle()
      if (keyData?.api_key) {
        try {
          const decrypted = decryptSecret(keyData.api_key)
          apiKeyMasked = maskSecret(decrypted)
          hasApiKey = true
        } catch {
          apiKeyMasked = '••••••••'
          hasApiKey = true
        }
      }
    }

    // Get recent sync logs
    const { data: syncLogs } = await supabase
      .from('easyorders_sync_logs')
      .select('id, sync_type, status, orders_processed, orders_imported, orders_updated, orders_skipped, orders_failed, errors, duration_ms, created_at')
      .order('created_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      config: data
        ? {
            ...data,
            api_key: undefined,
            api_key_masked: apiKeyMasked,
            has_api_key: hasApiKey,
          }
        : null,
      sync_logs: syncLogs || [],
    })
  } catch (error) {
    console.error('GET easyorders config error:', error)
    return NextResponse.json({ error: 'فشل تحميل إعدادات EasyOrders' }, { status: 500 })
  }
}

/**
 * PUT /api/integrations/easyorders
 * Save API key (encrypted at rest) + optional store info.
 */
export async function PUT(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const { api_key, store_id, store_name, webhook_secret } = body

    // PARTIAL updates: allow saving the webhook secret alone (API key may
    // already be stored and is never echoed back to the client).
    const hasApiKey = typeof api_key === 'string' && api_key.trim().length > 0
    const hasWebhookSecret = typeof webhook_secret === 'string' && webhook_secret.trim().length > 0
    const hasStoreInfo = Boolean(store_id || store_name)

    if (!hasApiKey && !hasWebhookSecret && !hasStoreInfo) {
      return NextResponse.json(
        { error: 'لا يوجد شيء لحفظه. أدخل مفتاح API أو Webhook Secret.' },
        { status: 400 }
      )
    }
    if (hasApiKey && api_key.trim().length < 10) {
      return NextResponse.json(
        { error: 'مفتاح API غير صحيح. يجب أن يكون 10 أحرف على الأقل.' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Check if config exists
    const { data: existing } = await supabase
      .from('easyorders_config')
      .select('id')
      .limit(1)
      .maybeSingle()

    const sharedFields: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (store_id) sharedFields.store_id = store_id
    if (store_name) sharedFields.store_name = store_name
    if (hasWebhookSecret) sharedFields.webhook_secret = encryptSecret(webhook_secret.trim())

    if (existing) {
      if (hasApiKey) sharedFields.api_key = encryptSecret(api_key.trim())
      // A re-saved key must be re-verified before claiming connection
      if (hasApiKey) sharedFields.is_connected = false

      const { error } = await supabase
        .from('easyorders_config')
        .update(sharedFields)
        .eq('id', existing.id)

      if (error) {
        console.error('PUT easyorders update failed:', error.message)
        throw error
      }
    } else {
      if (!hasApiKey) {
        return NextResponse.json(
          { error: 'لا يوجد تكوين بعد — أدخل مفتاح API أولاً قبل حفظ الـ Webhook Secret.' },
          { status: 400 }
        )
      }
      const { error } = await supabase.from('easyorders_config').insert({
        api_key: encryptSecret(api_key.trim()),
        ...sharedFields,
        is_connected: false,
      })

      if (error) {
        console.error('PUT easyorders insert failed:', error.message)
        throw error
      }
    }

    return NextResponse.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' })
  } catch (error) {
    console.error('PUT easyorders config error:', error)
    const detail = error instanceof Error ? error.message : ''
    return NextResponse.json(
      { error: detail ? `فشل حفظ الإعدادات: ${detail}` : 'فشل حفظ الإعدادات' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/integrations/easyorders
 *
 * Disconnect the integration — SOFT, and reversible.
 *
 * History (audit INC-001, 2026-11-20): this handler used to NULL OUT
 * `api_key` and `webhook_secret` and clear `store_id`. A single call with an
 * empty body therefore DESTROYED the encrypted credentials, and the only
 * copy of the EasyOrders API key lived in the (now deleted) ciphertext —
 * the integration stayed down until the key was re-issued from the
 * EasyOrders dashboard.
 *
 * It now:
 *   1. requires an explicit `confirm: "disconnect"` in the body,
 *   2. keeps the encrypted credentials and the store binding (so reconnect
 *      is one PUT away and no credential is ever lost),
 *   3. only flips `is_connected` to false,
 *   4. writes an audit_log row.
 */
export async function DELETE(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    // Explicit confirmation: a destructive integration action must never be
    // triggered by an empty body, a stray click or a replayed request.
    let body: { confirm?: string } = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    if (body.confirm !== 'disconnect') {
      return NextResponse.json(
        { error: 'يلزم تأكيد صريح: أرسل { "confirm": "disconnect" }' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Check if config exists
    const { data: existing } = await supabase
      .from('easyorders_config')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'لا يوجد تكوين لحذفه' }, { status: 404 })
    }

    // SOFT disconnect: the encrypted credentials and the store binding stay
    // in place. Nothing that was configured can be lost by accident.
    const { error } = await supabase
      .from('easyorders_config')
      .update({
        is_connected: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) throw error

    await supabase.from('audit_log').insert({
      user_id: auth.user.id,
      action: 'easyorders_disconnected',
      entity_type: 'easyorders_config',
      entity_id: existing.id,
      new_value: { is_connected: false, credentials_retained: true },
    })

    return NextResponse.json({
      success: true,
      message: 'تم فصل التكامل — تم الاحتفاظ بالمفتاح والسر، ويمكن إعادة الربط في أي وقت.',
      credentials_retained: true,
    })
  } catch (error) {
    console.error('DELETE easyorders config error:', error)
    return NextResponse.json({ error: 'فشل فصل التكامل' }, { status: 500 })
  }
}
