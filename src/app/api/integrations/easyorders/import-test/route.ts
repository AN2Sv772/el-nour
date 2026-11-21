import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { easyOrdersSyncService } from '@/lib/easyorders/sync'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

/**
 * POST /api/integrations/easyorders/import-test
 *
 * AUTHENTICATED diagnostic: pushes a clearly-marked test order through the
 * REAL import pipeline (processWebhookEvent → customer/product/order/items)
 * to prove the pipeline works with the current database state — without
 * needing to know the external webhook secret.
 *
 * The created order is marked with notes 'IMPORT-TEST' so it can be
 * identified and deleted by the user afterwards.
 *
 * SAFETY (audit INC-001, 2026-11-20): this endpoint writes REAL rows
 * (order + customer + product + order_item). An empty-body call created a
 * live order in production during the audit, and the record had to be
 * deleted by hand afterwards.
 *
 * It is therefore opt-in:
 *   * it refuses to run unless `ALLOW_EASYORDERS_IMPORT_TEST=1` is set in
 *     the environment, and
 *   * every run is written to `audit_log` so a test order can always be
 *     traced back to the call that created it.
 */
export async function POST(_request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  // Opt-in gate: the environment must explicitly allow production writes.
  if (process.env.ALLOW_EASYORDERS_IMPORT_TEST !== '1') {
    return NextResponse.json(
      {
        error:
          'مسار اختبار الاستيراد معطّل — يتطلب ALLOW_EASYORDERS_IMPORT_TEST=1 لأنه ينشئ طلبات وعملاء ومنتجات حقيقية.',
      },
      { status: 403 }
    )
  }

  const stamp = Date.now().toString(36)
  const testOrderId = `import-test-${stamp}`

  // Payload shaped exactly like the official webhook "order created" example
  const testPayload = {
    id: testOrderId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    store_id: 'import-test-store',
    cost: 100,
    shipping_cost: 30,
    total_cost: 130,
    status: 'pending',
    full_name: 'اختبار الاستيراد الداخلي',
    phone: '01000000000',
    government: 'القاهرة',
    address: 'طلب اختبار — يمكن حذفه بأمان',
    payment_method: 'cod',
    cart_items: [
      {
        id: `item-${stamp}`,
        product_id: `test-product-${stamp}`,
        store_id: 'import-test-store',
        price: 100,
        quantity: 1,
        product: {
          id: `test-product-${stamp}`,
          name: 'منتج اختبار الاستيراد الداخلي',
          price: 100,
          sku: `IMPORT-TEST-${stamp}`,
        },
      },
    ],
  }

  try {
    await easyOrdersSyncService.processWebhookEvent('order-created', testPayload)

    // Verify it landed
    const supabase = createServiceClient()
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, status')
      .eq('easyorders_order_id', testOrderId)
      .maybeSingle()

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'فشل الاستيراد — لم يتم إنشاء الطلب. راجع سجل المحاولات.' },
        { status: 500 }
      )
    }

    // Traceability: every diagnostic write is recorded, so a test row can
    // always be attributed (and removed) afterwards.
    await createServiceClient().from('audit_log').insert({
      user_id: auth.user.id,
      action: 'easyorders_import_test_created',
      entity_type: 'orders',
      entity_id: order.id,
      new_value: { easyorders_order_id: testOrderId, order_number: order.order_number },
    })

    return NextResponse.json({
      success: true,
      message: 'نجح الاستيراد — خط الأنابيب يعمل بشكل صحيح. يمكنك حذف طلب الاختبار من صفحة الطلبات.',
      order,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'خطأ غير معروف'
    console.error('import-test failed:', error)
    return NextResponse.json(
      { success: false, error: `فشل الاستيراد: ${msg}` },
      { status: 500 }
    )
  }
}
