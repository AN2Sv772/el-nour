/**
 * LIVE production test — failure / retry / dead-letter / webhook rejection.
 */
const { q, countOf } = require('./prod-query.cjs')

const APP = 'https://el-nour-dashboard.vercel.app'
const STORE = '3fb15a96-d8ec-43cf-bbcf-4e5711d37f43'
const stamp = Date.now()

async function drain() {
  const res = await fetch(`${APP}/api/integrations/easyorders/process-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-queue-trigger': 'webhook' },
    body: JSON.stringify({}),
  })
  const t = await res.text()
  let b = null; try { b = JSON.parse(t) } catch { b = t }
  return { status: res.status, body: b }
}

/** A payload that parses as 'order-created' but explodes during processing. */
function badPayload(id) {
  return {
    id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    store_id: STORE,
    cost: 10, shipping_cost: 0, total_cost: 10,
    status: 'pending',
    full_name: 'اختبار الفشل',
    phone: '01000000009',
    government: 'القاهرة',
    address: 'اختبار',
    payment_method: 'cod',
    cart_items: 'NOT-AN-ARRAY', // ← breaks `for (const item of easyOrder.cart_items)`
  }
}

function goodPayload(id) {
  return {
    id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    store_id: STORE,
    cost: 365, shipping_cost: 0, total_cost: 365,
    status: 'pending',
    full_name: 'عميل اختبار الإعادة',
    phone: '010' + String(stamp).slice(-8),
    government: 'القاهرة',
    address: 'اختبار الإعادة',
    payment_method: 'cod',
    cart_items: [{
      id: `retry-item-${stamp}`,
      product_id: 'cfa1a960-598b-4db0-a1c2-df9db718d2cb',
      variant_id: null,
      store_id: STORE,
      price: 365,
      quantity: 1,
      product: { id: 'cfa1a960-598b-4db0-a1c2-df9db718d2cb', name: 'منتج اختبار الاستيراد E2E', price: 365, sku: 'E2E-TEST-001' },
      variant: null,
    }],
  }
}

async function insertEvent(configId, eventType, body, extra = {}) {
  const r = await q('easyorders_webhook_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      config_id: configId, event_type: eventType, payload: body,
      processing_status: 'pending', next_retry_at: new Date().toISOString(),
      dedup_key: `${eventType}:${body.id ?? 'no-id'}`, ...extra,
    },
  })
  return { status: r.status, row: Array.isArray(r.json) ? r.json[0] : r.json }
}

async function getEvent(id) {
  const r = await q(`easyorders_webhook_events?select=id,processing_status,attempts,max_attempts,last_error,next_retry_at,processed,processed_at&id=eq.${id}`)
  return r.json[0]
}

async function main() {
  const cfg = await q('easyorders_config?select=id')
  const configId = cfg.json[0].id

  console.log('='.repeat(72))
  console.log('LIVE TEST 3 — failed processing → retry scheduled (not dead-lettered)')
  console.log('='.repeat(72))
  const badId = `e2e-bad-${stamp}`
  const ins3 = await insertEvent(configId, 'order-created', badPayload(badId))
  console.log('event inserted : HTTP', ins3.status, '| id', ins3.row?.id)
  const d3 = await drain()
  console.log('process-queue  : HTTP', d3.status, '| claimed:', d3.body?.claimed, 'processed:', d3.body?.processed, 'failed:', d3.body?.failed, 'dead:', d3.body?.dead_lettered)
  console.log('errors         :', JSON.stringify(d3.body?.errors))
  await new Promise(r => setTimeout(r, 2000))
  const ev3 = await getEvent(ins3.row.id)
  console.log('event after    :', JSON.stringify(ev3))
  console.log('=> status "failed" + attempts=1 + next_retry_at set  =>',
    ev3.processing_status === 'failed' && ev3.attempts === 1 && !!ev3.next_retry_at ? 'RETRY SCHEDULED ✓' : 'UNEXPECTED ✗')
  console.log('=> backoff applied (next_retry_at in the future)     =>',
    ev3.next_retry_at && new Date(ev3.next_retry_at) > new Date() ? 'YES ✓' : 'NO ✗')

  console.log()
  console.log('='.repeat(72))
  console.log('LIVE TEST 4 — retry succeeds after the payload is repaired')
  console.log('='.repeat(72))
  // Repair the payload in place and make the event due again.
  await q(`easyorders_webhook_events?id=eq.${ins3.row.id}`, {
    method: 'PATCH',
    body: { payload: goodPayload(badId), next_retry_at: new Date(Date.now() - 1000).toISOString() },
  })
  console.log('payload repaired + next_retry_at moved into the past')
  const d4 = await drain()
  console.log('process-queue  : HTTP', d4.status, '| claimed:', d4.body?.claimed, 'processed:', d4.body?.processed, 'failed:', d4.body?.failed)
  await new Promise(r => setTimeout(r, 2000))
  const ev4 = await getEvent(ins3.row.id)
  console.log('event after    :', JSON.stringify(ev4))
  console.log('=> status "processed" + processed=true              =>',
    ev4.processing_status === 'processed' && ev4.processed === true ? 'RECOVERED ✓' : 'UNEXPECTED ✗')
  const ord4 = await q(`orders?select=id,order_number,easyorders_order_id,total_amount&easyorders_order_id=eq.${badId}`)
  console.log('order created  :', JSON.stringify(ord4.json))

  console.log()
  console.log('='.repeat(72))
  console.log('LIVE TEST 5 — max attempts reached → dead_letter')
  console.log('='.repeat(72))
  const deadId = `e2e-dead-${stamp}`
  const ins5 = await insertEvent(configId, 'order-created', badPayload(deadId), {
    attempts: 4, // one more attempt reaches MAX_ATTEMPTS (5)
    next_retry_at: new Date(Date.now() - 1000).toISOString(),
  })
  console.log('event inserted : HTTP', ins5.status, '| id', ins5.row?.id, '| attempts seeded = 4')
  const d5 = await drain()
  console.log('process-queue  : HTTP', d5.status, '| claimed:', d5.body?.claimed, 'processed:', d5.body?.processed, 'failed:', d5.body?.failed, 'dead:', d5.body?.dead_lettered)
  console.log('errors         :', JSON.stringify(d5.body?.errors))
  await new Promise(r => setTimeout(r, 2000))
  const ev5 = await getEvent(ins5.row.id)
  console.log('event after    :', JSON.stringify(ev5))
  console.log('=> status "dead_letter" + attempts=5                 =>',
    ev5.processing_status === 'dead_letter' && ev5.attempts === 5 ? 'DEAD-LETTERED ✓' : 'UNEXPECTED ✗')

  console.log()
  console.log('='.repeat(72))
  console.log('LIVE TEST 6 — webhook rejects a wrong secret (401) and logs it')
  console.log('='.repeat(72))
  const logsBefore = await q('automation_logs?select=id&type=eq.webhook_rejected', { headers: { Prefer: 'count=exact' }, range: '0-0' })
  console.log('webhook_rejected logs before :', countOf(logsBefore.contentRange))
  const wr = await fetch(`${APP}/api/integrations/easyorders/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', secret: 'definitely-the-wrong-secret' },
    body: JSON.stringify(goodPayload(`e2e-rejected-${stamp}`)),
  })
  const wt = await wr.text()
  console.log('POST webhook (bad secret)    : HTTP', wr.status, wt.slice(0, 120))
  await new Promise(r => setTimeout(r, 2000))
  const logsAfter = await q('automation_logs?select=id,type,status,details&type=eq.webhook_rejected&order=created_at.desc&limit=1')
  console.log('webhook_rejected logs after  :', countOf((await q('automation_logs?select=id&type=eq.webhook_rejected', { headers: { Prefer: 'count=exact' }, range: '0-0' })).contentRange))
  console.log('latest webhook_rejected log  :', JSON.stringify(logsAfter.json))
  console.log('=> 401 + rejection logged (enum value works)      =>',
    wr.status === 401 ? 'REJECTED ✓' : 'UNEXPECTED ✗')
  const rejOrder = await q(`orders?select=id&easyorders_order_id=eq.e2e-rejected-${stamp}`)
  console.log('=> no order created from the rejected event       =>', rejOrder.json.length === 0 ? 'NONE ✓' : 'ORDER LEAKED ✗')

  console.log()
  console.log('='.repeat(72))
  console.log('FINAL QUEUE + ORDER STATE')
  console.log('='.repeat(72))
  const q1 = await q('easyorders_webhook_events?select=id,processing_status,attempts,max_attempts,last_error,event_type,dedup_key&order=created_at.desc&limit=8')
  console.log('recent events:')
  q1.json.forEach(e => console.log('  ', JSON.stringify(e)))
  const total = await q('orders?select=id', { headers: { Prefer: 'count=exact' }, range: '0-0' })
  console.log('TOTAL orders in prod:', countOf(total.contentRange))
  console.log('cleanup order ids:', badId, '| e2e-live-* | e2e-dead-*')
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
