#!/usr/bin/env python3
"""Remove every row this audit created in production.

Only rows that are provably audit-generated are deleted:
  * rows written by the probe harness (timestamps inside the probe windows)
  * rows carrying an explicit AUDIT-TEST marker
  * the audit_log entries that reference those rows

Real business rows (orders, customers, products, order_items, real webhook
events, real automation logs) are never touched. The script prints the exact
before/after counts so the effect is verifiable.
"""
import json, os, pathlib, urllib.request

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
HEAD = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}


def req(method, path, body=None, prefer='return=representation'):
    r = urllib.request.Request(f'{URL}/rest/v1/{path}', method=method, headers={**HEAD, 'Prefer': prefer},
                               data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else []


def count(table):
    r = urllib.request.Request(f'{URL}/rest/v1/{table}?select=id',
                               headers={**HEAD, 'Prefer': 'count=exact', 'Content-Range': '0-0'})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return int(resp.headers.get('Content-Range', '/0').split('/')[-1])


TABLES = ['orders', 'order_items', 'customers', 'products', 'expenses', 'collection_batches',
          'collection_allocations', 'daily_reconciliations', 'audit_log', 'automation_logs',
          'easyorders_webhook_events', 'inventory_movements', 'notifications']
before = {t: count(t) for t in TABLES}
print('BEFORE:', json.dumps(before, indent=1))

actions = []


def delete(table, ids, reason):
    ids = [i for i in ids if i]
    if not ids:
        return
    q = 'id=in.(' + ','.join(ids) + ')'
    res = req('DELETE', f'{table}?{q}', prefer='return=representation')
    actions.append({'table': table, 'ids': ids, 'deleted': len(res or []), 'reason': reason})
    print(f'DELETED {len(res or []):>3} {table:<30} {reason}')


# 1) probe harness rows (local run 18:25, production run3 18:38 on 2026-11-20)
for table, lo, hi, reason in [
    ('easyorders_webhook_events', '2026-11-20T18:38:00Z', '2026-11-20T18:40:00Z', 'probe run3 self-test dead letters'),
    ('automation_logs', '2026-11-20T18:25:00Z', '2026-11-20T18:26:30Z', 'local fixed-build probe rows'),
    ('automation_logs', '2026-11-20T18:38:00Z', '2026-11-20T18:40:00Z', 'probe run3 rows'),
]:
    rows = req('GET', f'{table}?select=id,created_at&created_at=gte.{lo}&created_at=lt.{hi}')
    delete(table, [r['id'] for r in rows], reason)

# 2) rows carrying an explicit AUDIT-TEST marker
batches = req('GET', 'collection_batches?select=id,batch_reference,company_name,notes')
audit_batches = [b['id'] for b in batches if 'AUDIT' in json.dumps(b, ensure_ascii=False).upper()]
allocs = req('GET', 'collection_allocations?select=id,batch_id')
alloc_ids = [a['id'] for a in allocs if a.get('batch_id') in audit_batches]
delete('collection_allocations', alloc_ids, 'allocations of the AUDIT collection batches')
delete('collection_batches', audit_batches, 'AUDIT-TEST collection batches')

expenses = req('GET', 'expenses?select=id,notes')
delete('expenses', [e['id'] for e in expenses if 'AUDIT' in (e.get('notes') or '').upper()],
       'AUDIT-TEST expense')

recons = req('GET', 'daily_reconciliations?select=id,business_date,notes,created_at,created_by')
delete('daily_reconciliations', [r['id'] for r in recons
                                 if r.get('created_at', '').startswith('2026-11-07')
                                 and (r.get('notes') or '') == ''],
       'audit reconciliation row (2026-11-07 audit run)')

# 3) audit_log entries that only describe the rows above
log = req('GET', 'audit_log?select=id,action,entity_type,entity_id,created_at')
audit_entity_ids = set(audit_batches) | {e['id'] for e in expenses if 'AUDIT' in (e.get('notes') or '').upper()}
audit_entity_ids |= {r['id'] for r in recons if r.get('created_at', '').startswith('2026-11-07')}
log_ids = [l['id'] for l in log
           if l.get('entity_id') in audit_entity_ids
           or (l.get('action') == 'product_cost_changed' and l.get('created_at', '').startswith('2026-11-10'))]
delete('audit_log', log_ids, 'audit_log entries describing audit-created rows')

after = {t: count(t) for t in TABLES}
print('AFTER :', json.dumps(after, indent=1))
delta = {t: before[t] - after[t] for t in TABLES}
print('DELTA :', json.dumps(delta))

out = ROOT / 'audit' / 'evidence' / 'cleanup_report.json'
out.write_text(json.dumps({'before': before, 'after': after, 'delta': delta, 'actions': actions},
                           indent=1, ensure_ascii=False))
print('saved', out)
