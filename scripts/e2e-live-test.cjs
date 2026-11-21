/**
 * LIVE production pipeline test.
 *
 * Drives the REAL deployed EasyOrders processing pipeline:
 *   event row (pending) -> production process-queue -> order + items + log
 *
 * Uses the service role key to insert the queue event (simulating the
 * webhook receiver's durable enqueue) and the public `x-queue-trigger`
 * header to make production drain it.
 */
const { q, countOf } = require('./prod-query.cjs')

const APP = 'https://el-nour-dashboard.vercel.app'
const STORE = '3fb15a96-d8ec-43cf-bbcf-4e5711d37f43'
const PRODUCT = {
  id: 'cfa1a960-598b-4db0-a1c2-df9db718d2cb',
  name: 'منتج اختبار الاستيراد E2E',
  price: 365,
  sku: 'E2E-TEST-001',
}

const stamp = Date.now()
const TEST_ORDER_ID = `e2e-live-${stamp}`
const TEST_PHONE = '010' + String(stamp).slice(-8)

function payload(orderId, phone) {
  return {
    id: orderId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    store_id: STORE,
    cost: PRODUCT.price,
    shipping_cost: 0,
    total_cost: PRODUCT.price,
    status: 'pending',
    full_name: 'عميل اختبار E2E آلي',
    phone,
    government: 'القاهرة',
    address: 'اختبار E2E آلي — يمكن حذف هذا الطلب بأمان',
    payment_method: 'cod',
    cart_items: [
      {
        id: `e2e-item-${stamp}`,
        product_id: PRODUCT.id,
        variant_id: null,
        store_id: STORE,
        price: PRODUCT.price,
        quantity: 1,
        product: { id: PRODUCT.id, name: PRODUCT.name, price: PRODUCT.price, sku: PRODUCT.sku },
        variant: null,
      },
    ],
  }
}

async function insertEvent(configId, eventType, body, extra = {}) {
  const r = await q('easyorders_webhook_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      config_id: configId,
      event_type: eventType,
      payload: body,
      processing_status: 'pending',
      next_retry_at: new Date().toISOString(),
      dedup_key: `${eventType}:${body.id ?? 'no-id'}`,
      ...extra,
    },
  })
  return r
}

async function drainQueue() {
  const res = await fetch(`${APP}/api/integrations/easyorders/process-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-queue-trigger': 'webhook' },
    body: JSON.stringify({}),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

async function main() {
  const cfg = await q('easyorders_config?select=id')
  const configId = cfg.json[0].id

  console.log('='.repeat(72))
  console.log('LIVE TEST 1 — full pipeline: queue event -> production -> order')
  console.log('='.repeat(72))
  console.log('test order id :', TEST_ORDER_ID)
  console.log('test phone    :', TEST_PHONE)
  console.log()

  const before = await q('orders?select=id&easyorders_order_id=eq.' + TEST_ORDER_ID)
  console.log('orders before :', before.json.length)

  const ins = await insertEvent(configId, 'order-created', payload(TEST_ORDER_ID, TEST_PHONE))
  console.log('event insert  : HTTP', ins.status, ins.json?.id ? '(id ' + ins.json.id + ')' : JSON.stringify(ins.json))
  if (ins.status >= 400) { console.log('ABORT'); return }

  const ev = await q('easyorders_webhook_events?select=id,processing_status,attempts,last_error&id=eq.' + ins.json.id)
  console.log('event before  :', JSON.stringify(ev.json[0]))

  const drain = await drainQueue()
  console.log()
  console.log('process-queue : HTTP', drain.status)
  console.log('response      :', JSON.stringify(drain.body, null, 1).slice(0, 900))

  await new Promise(r => setTimeout(r, 2500))

  const ev2 = await q('easyorders_webhook_events?select=id,processing_status,attempts,last_error,processed,processed_at&id=eq.' + ins.json.id)
  console.log()
  console.log('event after   :', JSON.stringify(ev2.json[0]))

  const ord = await q('orders?select=id,order_number,easyorders_order_id,easyorders_store_id,status,payment_status,total_amount,subtotal,source,notes,customer_id,created_at&easyorders_order_id=eq.' + TEST_ORDER_ID)
  console.log()
  console.log('order after   : rows =', ord.json.length)
  console.log(JSON.stringify(ord.json, null, 1))

  if (ord.json.length) {
    const items = await q('order_items?select=id,order_id,product_id,sku,product_name,quantity,unit_price,total_price,unit_cost&order_id=eq.' + ord.json[0].id)
    console.log('order_items   :', JSON.stringify(items.json, null, 1))
    const cust = await q('customers?select=id,name,phone,governorate&id=eq.' + ord.json[0].customer_id)
    console.log('customer      :', JSON.stringify(cust.json))
  }

  const logs = await q('automation_logs?select=type,status,reference_id,details&reference_id=eq.' + (ord.json[0]?.id ?? 'none'))
  console.log('automation_log:', JSON.stringify(logs.json, null, 1))

  console.log()
  console.log('='.repeat(72))
  console.log('LIVE TEST 2 — duplicate delivery must be idempotent (no 2nd order)')
  console.log('='.repeat(72))
  const dupIns = await insertEvent(configId, 'order-created', payload(TEST_ORDER_ID, TEST_PHONE))
  console.log('duplicate event insert : HTTP', dupIns.status, '| id', dupIns.json?.id)
  const drain2 = await drainQueue()
  console.log('process-queue           : HTTP', drain2.status, '| claimed:', drain2.body?.claimed, 'processed:', drain2.body?.processed, 'failed:', drain2.body?.failed)
  await new Promise(r => setTimeout(r, 2500))
  const after = await q('orders?select=id,order_number&easyorders_order_id=eq.' + TEST_ORDER_ID)
  console.log('orders with that id    :', after.json.length, after.json.length === 1 ? '=> IDEMPOTENT ✓' : '=> DUPLICATE CREATED ✗')
  const ev3 = await q('easyorders_webhook_events?select=id,processing_status,attempts,last_error&id=eq.' + dupIns.json.id)
  console.log('duplicate event after   :', JSON.stringify(ev3.json[0]))
  const allOrders = await q('orders?select=id', { headers: { Prefer: 'count=exact' }, range: '0-0' })
  console.log('TOTAL orders in prod    :', countOf(allOrders.contentRange))

  console.log()
  console.log('='.repeat(72))
  console.log('SUMMARY')
  console.log('='.repeat(72))
  console.log('test order id (for cleanup):', TEST_ORDER_ID)
  console.log('test phone (for cleanup)   :', TEST_PHONE)
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
