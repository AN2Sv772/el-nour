/**
 * Removes ONLY the clearly-marked test artifacts created by the E2E
 * verification runs. Every deletion is filtered on an explicit marker
 * (`e2e-` / `import-test-`), so no real EasyOrders order can be touched.
 *
 * Run with --dry-run first (default) to see exactly what would be removed.
 * Pass --apply to actually delete.
 */
const { q, countOf } = require('./prod-query.cjs')

const APPLY = process.argv.includes('--apply')
const MARKERS = ['e2e-%', 'import-test-%']

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (pass --apply to execute) ===')
  console.log('markers:', MARKERS.join(', '))
  console.log()

  const results = {}

  // 1. Orders created by the test pipeline
  const orderIds = []
  for (const m of MARKERS) {
    const r = await q(`orders?select=id,easyorders_order_id,order_number,total_amount&easyorders_order_id=like.${encodeURIComponent(m)}`, { headers: { Prefer: 'count=exact' }, range: '0-99' })
    console.log(`orders like ${m}: ${countOf(r.contentRange)}`)
    ;(r.json || []).forEach(o => { orderIds.push(o); })
  }
  results.orders = orderIds
  console.log('  -> orders to delete:')
  orderIds.forEach(o => console.log(`     ${o.id}  ${o.easyorders_order_id}  ${o.order_number}  ${o.total_amount}`))

  // 2. Their order_items (FK-linked)
  const itemIds = []
  for (const o of orderIds) {
    const r = await q(`order_items?select=id&order_id=eq.${o.id}`)
    ;(r.json || []).forEach(i => itemIds.push(i.id))
  }
  results.order_items = itemIds
  console.log(`  -> order_items to delete: ${itemIds.length}`)

  // 3. Customers created for the tests.
  //    Filtered by the TEST NAME, never by a phone prefix — a phone-prefix
  //    pattern also matches real customers (e.g. a real customer whose
  //    number happened to start with the same digits).
  const custIds = []
  for (const nameLike of ['%اختبار%', 'E2E%']) {
    const r = await q(`customers?select=id,phone,name&name=like.${encodeURIComponent(nameLike)}`, { headers: { Prefer: 'count=exact' }, range: '0-99' })
    console.log(`customers name like ${nameLike}: ${countOf(r.contentRange)}`)
    ;(r.json || []).forEach(c => {
      if (!custIds.some(x => x.id === c.id)) custIds.push(c)
    })
  }
  results.customers = custIds
  console.log('  -> customers to delete:')
  custIds.forEach(c => console.log(`     ${c.id}  ${c.phone}  ${c.name}`))

  // 4. Queue events created by the tests (dedup_key marker)
  const evIds = []
  for (const m of ['*e2e-*', '*import-test-*']) {
    const r = await q(`easyorders_webhook_events?select=id,dedup_key,event_type,processing_status&dedup_key=like.${encodeURIComponent(m)}`, { headers: { Prefer: 'count=exact' }, range: '0-99' })
    console.log(`queue events dedup_key like ${m}: ${countOf(r.contentRange)}`)
    ;(r.json || []).forEach(e => { if (!evIds.some(x => x.id === e.id)) evIds.push(e) })
  }
  results.events = evIds
  console.log('  -> queue events to delete:')
  evIds.forEach(e => console.log(`     ${e.id}  ${e.dedup_key}  ${e.processing_status}`))

  // 5. automation_logs for the test orders
  const logIds = []
  for (const o of orderIds) {
    const r = await q(`automation_logs?select=id,type&reference_id=eq.${o.id}`)
    ;(r.json || []).forEach(l => logIds.push(l.id))
  }
  results.logs = logIds
  console.log(`  -> automation_logs to delete: ${logIds.length}`)

  // 6. Test PRODUCTS left behind by the import/E2E runs.
  //    A product is only eligible when it is (a) named with a test marker AND
  //    (b) referenced by ZERO order_items and ZERO inventory_movements — a
  //    product that any real order touches is never deleted, whatever its
  //    name.
  const productIds = []
  for (const nameLike of ['%اختبار الاستيراد%', 'AUDIT-TEST%']) {
    const r = await q(`products?select=id,name,cost_price&name=like.${encodeURIComponent(nameLike)}`, { range: '0-99' })
    ;(r.json || []).forEach(p => {
      if (productIds.some(x => x.id === p.id)) return
      productIds.push(p)
    })
  }
  const orphanProducts = []
  for (const p of productIds) {
    const items = await q(`order_items?select=id&product_id=eq.${p.id}`, { headers: { Prefer: 'count=exact' }, range: '0-0' })
    const itemCount = countOf(items.contentRange)
    const moves = await q(`inventory_movements?select=id&product_id=eq.${p.id}`, { headers: { Prefer: 'count=exact' }, range: '0-0' })
    const moveCount = countOf(moves.contentRange)
    if (itemCount === 0 && moveCount === 0) {
      orphanProducts.push(p)
      console.log(`  -> orphan test product (0 refs): ${p.id}  ${p.name}`)
    } else {
      console.log(`  !! KEEPING referenced product: ${p.id}  ${p.name}  items=${itemCount} movements=${moveCount}`)
    }
  }
  results.products = orphanProducts

  const totals = Object.entries(results).map(([k, v]) => `${k}=${v.length}`).join('  ')
  console.log(`\nTOTAL: ${totals}`)

  if (!APPLY) {
    console.log('\nDry run only — nothing was deleted.')
    return
  }

  console.log('\n--- deleting ---')
  const del = async (table, ids) => {
    if (!ids.length) return
    let ok = 0
    let failed = 0
    for (const id of ids) {
      const r = await q(`${table}?id=eq.${id}`, { method: 'DELETE' })
      if (r.status >= 300) {
        failed++
        console.log(`  !! ${table}/${id} -> HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
      } else {
        ok++
      }
    }
    console.log(`  ${table}: deleted ${ok}${failed ? ` (${failed} FAILED)` : ''}`)
    if (failed) process.exitCode = 1
  }
  await del('order_items', results.order_items)
  await del('automation_logs', results.logs)
  // `results.events` holds ROWS, not ids — map them, otherwise the filter
  // becomes the literal string "[object Object]" and every delete 400s.
  await del('easyorders_webhook_events', results.events.map(e => e.id))
  await del('orders', results.orders.map(o => o.id))
  await del('customers', results.customers.map(c => c.id))
  // Products last: they are only deleted when nothing references them, and
  // the order_items delete above may have been what freed them.
  await del('products', results.products.map(p => p.id))

  console.log('\n--- verifying ---')
  for (const m of MARKERS) {
    const r = await q(`orders?select=id&easyorders_order_id=like.${encodeURIComponent(m)}`, { headers: { Prefer: 'count=exact' }, range: '0-0' })
    console.log(`  orders like ${m}: ${countOf(r.contentRange)}`)
  }
  const t = await q('orders?select=id', { headers: { Prefer: 'count=exact' }, range: '0-0' })
  console.log(`  TOTAL orders: ${countOf(t.contentRange)}`)
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
