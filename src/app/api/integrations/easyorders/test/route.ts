import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { easyOrdersService } from '@/lib/easyorders/service'
import { decryptSecret } from '@/lib/crypto'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * POST /api/integrations/easyorders/test
 *
 * Tests the EasyOrders connection against an endpoint that actually exists
 * in the official API (GET /products — per public-api-docs.easy-orders.net).
 * The previous implementation used GET /stores/me, which does NOT exist
 * (404 with empty body) — that was the root cause of "فشل اختبار الاتصال".
 *
 * Accepts optional { api_key } in body for testing before saving;
 * otherwise uses the stored (encrypted) key.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    let apiKey: string | null = null
    let persistResult = false

    // Optional key from body (test-before-save)
    try {
      const body = await request.json()
      if (body?.api_key && typeof body.api_key === 'string' && body.api_key.trim()) {
        apiKey = body.api_key.trim()
      }
    } catch {
      // No body — fall through to stored key
    }

    if (!apiKey) {
      const { data: config, error: configError } = await supabase
        .from('easyorders_config')
        .select('api_key')
        .limit(1)
        .maybeSingle()

      if (configError) {
        console.error('test: failed reading config:', configError.message)
        return NextResponse.json(
          { success: false, error: 'فشل قراءة الإعدادات المحفوظة من قاعدة البيانات.' },
          { status: 500 }
        )
      }

      if (!config?.api_key) {
        return NextResponse.json(
          { success: false, error: 'لم يتم حفظ مفتاح API بعد. أضف المفتاح أولاً ثم احفظه.' },
          { status: 400 }
        )
      }

      try {
        apiKey = decryptSecret(config.api_key)
      } catch {
        return NextResponse.json(
          { success: false, error: 'فشل فك تشفير المفتاح المحفوظ. أعد إدخال المفتاح واحفظه مرة أخرى.' },
          { status: 500 }
        )
      }
      persistResult = true
    }

    // Test against the official API: GET /products returns the store's
    // products as a direct JSON array; store_id is on each product.
    const result = await easyOrdersService.testConnectionWithKey(apiKey!)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'فشل الاتصال بـ EasyOrders' },
        { status: 400 }
      )
    }

    const storeId = result.store?.id || null

    // Persist verified state only after a successful response
    if (persistResult || storeId) {
      const { data: existing } = await supabase
        .from('easyorders_config')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (existing) {
        // NOTE: only columns that exist in easyorders_config (no last_verified_at)
        const updateData: Record<string, unknown> = {
          is_connected: true,
          updated_at: new Date().toISOString(),
        }
        if (storeId) updateData.store_id = storeId
        const { error: updateError } = await supabase
          .from('easyorders_config')
          .update(updateData)
          .eq('id', existing.id)
        if (updateError) {
          console.error('test: failed persisting connection state:', updateError.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'تم الاتصال بنجاح — المفتاح صالح ويعمل',
      store: { id: storeId, name: null },
    })
  } catch (error) {
    console.error('EasyOrders test connection error:', error)
    const detail = error instanceof Error ? error.message : 'خطأ غير معروف'
    return NextResponse.json(
      { success: false, error: `فشل اختبار الاتصال: ${detail}` },
      { status: 500 }
    )
  }
}
