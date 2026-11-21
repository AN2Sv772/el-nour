#!/usr/bin/env python3
"""Read-only integrity audit of the El Nour Dashboard production database.

Everything here is a SELECT through PostgREST with the service role; no write
path is used. The script reports violations with concrete identifiers so the
findings can be reproduced.
"""
import json, os, pathlib, urllib.request, urllib.error, sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV = {}
for line in (ROOT / '.env.local').read_text().split('\n'):
    t = line.strip()
    if not t or t.startswith('#'):
        continue
    i = t.find('=')
    if i == -1:
        continue
    k, v = t[:i].strip(), t[i+1:].strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        v = v[1:-1]
    ENV[k] = v

URL = ENV['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
KEY = ENV['SUPABASE_SERVICE_ROLE_KEY']
OUT = ROOT / 'audit' / 'evidence'


def get(path, limit=1000, offset=0):
    url = f'{URL}/rest/v1/{path}&limit={limit}&offset={offset}'
    req = urllib.request.Request(url, headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode() or '[]')


def fetch_all(table, columns='*', page=1000):
    rows, offset = [], 0
    while True:
        batch = get(f'{table}?select={columns}', limit=page, offset=offset)
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def count(table, query=''):
    url = f'{URL}/rest/v1/{table}?select=id&{query}' if query else f'{URL}/rest/v1/{table}?select=id'
    req = urllib.request.Request(url, headers={
        'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
        'Prefer': 'count=exact', 'Content-Range': '0-0'})
    with urllib.request.urlopen(req, timeout=90) as resp:
        cr = resp.headers.get('Content-Range', '')
        return int(cr.split('/')[-1]) if '/' in cr else -1


report = {'generated_at': None, 'tables': {}, 'checks': []}


def check(name, status, detail, examples=None):
    report['checks'].append({
        'check': name, 'status': status, 'detail': detail,
        'examples': (examples or [])[:10],
    })
    print(f'[{status:8s}] {name}: {detail}')
    for e in (examples or [])[:5]:
        print('           -', e)


print('== row counts ==')
tables = ['orders', 'order_items', 'customers', 'products', 'expenses',
          'collection_batches', 'collection_allocations', 'daily_reconciliations',
          'inventory_movements', 'knowledge_base', 'notifications', 'audit_log',
          'automation_logs', 'order_confirmations', 'order_confirmation_events',
          'order_status_history', 'easyorders_config', 'easyorders_sync_logs',
          'easyorders_webhook_events', 'user_profiles']
for t in tables:
    try:
        c = count(t)
        report['tables'][t] = c
        print(f'   {t:32s} {c}')
    except Exception as e:
        report['tables'][t] = str(e)[:80]
        print(f'   {t:32s} ERROR {e}')

print('\n== integrity checks ==')

# --- orders -> customers / order_items
orders = fetch_all('orders', 'id,order_number,customer_id,status,payment_status,total_amount,subtotal,shipping_fee,discount_amount,tax_amount,created_at,easyorders_order_id,source')
items = fetch_all('order_items', 'id,order_id,product_id,quantity,unit_price,total_price,unit_cost')
customers = fetch_all('customers', 'id,name,phone,email,total_orders,total_spent,created_at')
products = fetch_all('products', 'id,sku,name,price,cost_price,stock_quantity,track_inventory,is_active')

order_ids = {o['id'] for o in orders}
item_order_ids = {i['order_id'] for i in items if i.get('order_id')}
customer_ids = {c['id'] for c in customers}
product_ids = {p['id'] for p in products}

orphan_items = [i['id'] for i in items if i.get('order_id') and i['order_id'] not in order_ids]
check('order_items without a parent order', 'PASS' if not orphan_items else 'FAIL',
      f'{len(orphan_items)} orphan line items', orphan_items)

orders_no_customer = [o['order_number'] for o in orders if o.get('customer_id') and o['customer_id'] not in customer_ids]
check('orders pointing at a missing customer', 'PASS' if not orders_no_customer else 'FAIL',
      f'{len(orders_no_customer)} orders', orders_no_customer)

orphan_customer_links = [o['order_number'] for o in orders if not o.get('customer_id')]
check('orders without a customer reference', 'PASS' if not orphan_customer_links else 'WARN',
      f'{len(orphan_customer_links)} orders have customer_id = null', orphan_customer_links)

orders_no_items = [o['order_number'] for o in orders if o['id'] not in item_order_ids]
check('orders without any line item', 'PASS' if not orders_no_items else 'WARN',
      f'{len(orders_no_items)} orders', orders_no_items)

orphan_product_links = [i['id'] for i in items if i.get('product_id') and i['product_id'] not in product_ids]
check('order_items pointing at a missing product', 'PASS' if not orphan_product_links else 'FAIL',
      f'{len(orphan_product_links)} line items', orphan_product_links)

dup_numbers = [n for n, c in Counter(o['order_number'] for o in orders if o.get('order_number')).items() if c > 1]
check('duplicate order numbers', 'PASS' if not dup_numbers else 'FAIL',
      f'{len(dup_numbers)} duplicated order numbers', dup_numbers)

dup_eo_ids = [n for n, c in Counter(o['easyorders_order_id'] for o in orders if o.get('easyorders_order_id')).items() if c > 1]
check('duplicate EasyOrders identifiers (re-import guard)', 'PASS' if not dup_eo_ids else 'FAIL',
      f'{len(dup_eo_ids)} duplicated external ids', dup_eo_ids)

bad_totals = []
for o in orders:
    try:
        sub = float(o.get('subtotal') or 0); total = float(o.get('total_amount') or 0)
        ship = float(o.get('shipping_fee') or 0); disc = float(o.get('discount_amount') or 0)
        tax = float(o.get('tax_amount') or 0)
    except (TypeError, ValueError):
        bad_totals.append((o['order_number'], 'non-numeric amounts')); continue
    if abs((sub - disc + ship + tax) - total) > 0.01:
        bad_totals.append((o['order_number'], f'{sub} - {disc} + {ship} + {tax} != {total}'))
check('order totals equal subtotal - discount + shipping + tax', 'PASS' if not bad_totals else 'FAIL',
      f'{len(bad_totals)} orders violate the identity', [f'{a}: {b}' for a, b in bad_totals])

bad_line_totals = []
for i in items:
    try:
        qty = float(i.get('quantity') or 0); price = float(i.get('unit_price') or 0)
        disc = float(i.get('discount') or 0); total = float(i.get('total_price') or 0)
    except (TypeError, ValueError):
        bad_line_totals.append(i['id']); continue
    if abs((qty * price - disc) - total) > 0.01:
        bad_line_totals.append((i['id'], f'{qty}*{price} - {disc} != {total}'))
check('line totals equal quantity * price - discount', 'PASS' if not bad_line_totals else 'FAIL',
      f'{len(bad_line_totals)} line items violate the identity', [str(x) for x in bad_line_totals])

neg_qty = [i['id'] for i in items if (i.get('quantity') or 0) < 0]
check('negative quantities', 'PASS' if not neg_qty else 'FAIL', f'{len(neg_qty)} line items', neg_qty)
neg_price = [i['id'] for i in items if (i.get('unit_price') or 0) < 0]
check('negative unit prices', 'PASS' if not neg_price else 'FAIL', f'{len(neg_price)} line items', neg_price)

# --- customers
dup_phones = [p for p, c in Counter(c.get('phone') for c in customers if c.get('phone')).items() if c > 1]
check('duplicate customer phone numbers', 'PASS' if not dup_phones else 'FAIL',
      f'{len(dup_phones)} duplicated phone numbers', dup_phones)

counter_mismatch = []
orders_per_customer = Counter(o['customer_id'] for o in orders if o.get('customer_id'))
for c in customers:
    expected = orders_per_customer.get(c['id'], 0)
    stored = c.get('total_orders')
    if stored is None:
        continue
    if int(stored) != expected:
        counter_mismatch.append((c['name'], c['phone'], 'stored=' + str(stored), 'actual=' + str(expected)))
check('customers.total_orders equals the real order count', 'PASS' if not counter_mismatch else 'FAIL',
      f'{len(counter_mismatch)} of {len(customers)} customers disagree', [str(x) for x in counter_mismatch])

spend_mismatch = []
revenue_per_customer = defaultdict(float)
for o in orders:
    if o.get('customer_id') and o.get('status') not in ('cancelled', 'returned'):
        revenue_per_customer[o['customer_id']] += float(o.get('total_amount') or 0)
for c in customers:
    stored = c.get('total_spent')
    if stored is None:
        continue
    actual = revenue_per_customer.get(c['id'], 0.0)
    if abs(float(stored) - actual) > 1.0:
        spend_mismatch.append((c['name'], c['phone'], 'stored=' + str(stored), 'actual=' + round(actual, 2)))
check('customers.total_spent equals the summed order value', 'PASS' if not spend_mismatch else 'WARN',
      f'{len(spend_mismatch)} of {len(customers)} customers disagree', [str(x) for x in spend_mismatch])

# --- products / stock
missing_sku = [p['id'] for p in products if not (p.get('sku') or '').strip()]
check('products without a SKU', 'PASS' if not missing_sku else 'WARN', f'{len(missing_sku)} products', missing_sku)
zero_cost = [p['sku'] for p in products if (p.get('cost_price') or 0) == 0]
check('products with cost_price = 0 (COGS cannot be computed)', 'WARN' if zero_cost else 'PASS',
      f'{len(zero_cost)} of {len(products)} products have no cost price', zero_cost)
neg_stock = [p['sku'] for p in products if (p.get('stock_quantity') or 0) < 0]
check('negative stock quantity', 'PASS' if not neg_stock else 'FAIL', f'{len(neg_stock)} products', neg_stock)
tracked_negative = [p['sku'] for p in products if p.get('track_inventory') and (p.get('stock_quantity') or 0) < 0]
check('tracked products with negative stock', 'PASS' if not tracked_negative else 'FAIL',
      f'{len(tracked_negative)} products', tracked_negative)

# --- order status values
STATUSES = {'pending', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready_for_shipping',
            'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'failed_delivery'}
bad_status = [o['order_number'] for o in orders if o.get('status') not in STATUSES]
check('orders with an unknown status', 'PASS' if not bad_status else 'FAIL',
      f'{len(bad_status)} orders', bad_status)
print('\nstatus distribution:', dict(Counter(o.get('status') for o in orders)))

# --- expenses
expenses = fetch_all('expenses', 'id,category,amount,expense_date,voided_at,created_by')
neg_exp = [e['id'] for e in expenses if (e.get('amount') or 0) < 0]
check('negative expense amounts', 'PASS' if not neg_exp else 'FAIL', f'{len(neg_exp)} expenses', neg_exp)
bad_cat = [e['id'] for e in expenses if e.get('category') not in ('shipping', 'packaging', 'advertising', 'other')]
check('expenses with an unknown category', 'PASS' if not bad_cat else 'FAIL', f'{len(bad_cat)} expenses', bad_cat)

# --- collections / reconciliations
batches = fetch_all('collection_batches', 'id,batch_reference,company_name,expected_amount,received_amount,status,created_at')
allocations = fetch_all('collection_allocations', 'id,batch_id,order_id,allocated_amount,created_at')
batch_ids = {b['id'] for b in batches}
orphan_alloc = [a['id'] for a in allocations if a.get('batch_id') and a['batch_id'] not in batch_ids]
check('collection allocations without a parent batch', 'PASS' if not orphan_alloc else 'FAIL',
      f'{len(orphan_alloc)} allocations', orphan_alloc)
alloc_by_batch = defaultdict(float)
for a in allocations:
    alloc_by_batch[a['batch_id']] += float(a.get('allocated_amount') or 0)
batch_sum_mismatch = []
for b in batches:
    total = b.get('expected_amount')
    if total is None:
        continue
    if abs(float(total) - alloc_by_batch.get(b['id'], 0.0)) > 0.01:
        batch_sum_mismatch.append((b.get('batch_reference'), 'expected=' + str(total), 'allocations=' + str(round(alloc_by_batch.get(b['id'], 0.0), 2))))
check('collection batch expected_amount equals the sum of its allocations', 'PASS' if not batch_sum_mismatch else 'FAIL',
      f'{len(batch_sum_mismatch)} of {len(batches)} batches disagree', [str(x) for x in batch_sum_mismatch])

alloc_order_ids = {a['order_id'] for a in allocations if a.get('order_id')}
alloc_orphan_orders = [a['id'] for a in allocations if a.get('order_id') and a['order_id'] not in order_ids]
check('collection allocations pointing at a missing order', 'PASS' if not alloc_orphan_orders else 'FAIL',
      f'{len(alloc_orphan_orders)} allocations', alloc_orphan_orders)

reconciliations = fetch_all('daily_reconciliations', 'id,business_date,orders_count,provisional_sales,provisional_cogs,provisional_profit,reconciled_profit,returned_orders_value,returned_products_value')
recon_mismatch = []
for r in reconciliations:
    try:
        sales = float(r.get('provisional_sales') or 0); cogs = float(r.get('provisional_cogs') or 0)
        profit = float(r.get('provisional_profit') or 0)
        ret_o = float(r.get('returned_orders_value') or 0); ret_p = float(r.get('returned_products_value') or 0)
        rec = float(r.get('reconciled_profit') or 0)
    except (TypeError, ValueError):
        recon_mismatch.append((r.get('business_date'), 'non-numeric')); continue
    if abs((sales - cogs) - profit) > 0.01:
        recon_mismatch.append((r.get('business_date'), f'sales {sales} - cogs {cogs} != profit {profit}'))
    elif abs((profit - ret_o + ret_p) - rec) > 0.01:
        recon_mismatch.append((r.get('business_date'), f'profit {profit} - returned_orders {ret_o} + returned_products {ret_p} != reconciled {rec}'))
check('daily reconciliation arithmetic', 'PASS' if not recon_mismatch else 'FAIL',
      f'{len(recon_mismatch)} of {len(reconciliations)} reconciliations disagree', [str(x) for x in recon_mismatch])

# --- reconciliation coverage against the real order table
orders_by_day = Counter(o['created_at'][:10] for o in orders)
recon_days = {r.get('business_date') for r in reconciliations}
unreconciled_days = sorted(d for d in orders_by_day if d not in recon_days)
check('business days with orders but no reconciliation row', 'WARN' if unreconciled_days else 'PASS',
      f'{len(unreconciled_days)} of {len(orders_by_day)} order days have no reconciliation row',
      unreconciled_days[:10])

# --- users / roles
profiles = fetch_all('user_profiles', 'id,email,role,full_name,created_at')
bad_roles = [p['email'] for p in profiles if p.get('role') not in ('viewer', 'employee', 'manager', 'admin')]
check('user profiles with an unknown role', 'PASS' if not bad_roles else 'FAIL', f'{len(bad_roles)} profiles', bad_roles)
print('\nrole distribution:', dict(Counter(p.get('role') for p in profiles)))

# --- audit trail
audit_rows = fetch_all('audit_log', 'id,action,entity_type,entity_id,user_id,created_at')
check('audit_log is populated', 'PASS' if audit_rows else 'WARN',
      f'{len(audit_rows)} audit rows (sampled up to 2000)', [r['action'] for r in audit_rows[:5]])

report['summary'] = {
    'pass': sum(1 for c in report['checks'] if c['status'] == 'PASS'),
    'fail': sum(1 for c in report['checks'] if c['status'] == 'FAIL'),
    'warn': sum(1 for c in report['checks'] if c['status'] == 'WARN'),
}
import datetime
report['generated_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(OUT / 'db_integrity_report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False))
print('\nSUMMARY', report['summary'])
print('saved', OUT / 'db_integrity_report.json')
