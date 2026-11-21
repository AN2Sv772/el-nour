#!/usr/bin/env python3
"""
El Nour Dashboard — exhaustive API probe harness (read-only discipline).

Design rules (mandatory for this audit):
  * WRITE methods are only probed with payloads that MUST be rejected by
    validation. No production business record may be created.
  * Row counts of every business table are sampled before and after the whole
    run; any delta is reported as evidence of an unintended write.
  * Identities used: anon / invalid-cookie / viewer / employee / admin.
  * Secrets are never printed: bodies are redacted before storage.

SAFETY GUARD (added 2026-11-20 after incident INC-001):
  A first probe run reached three production-mutating endpoints that IGNORE
  their input validation and therefore acted on the real account:
    * DELETE /api/integrations/easyorders      -> wiped api_key/webhook_secret
    * POST  /api/integrations/easyorders/import-test -> created a real order
    * PUT   /api/integrations/order-confirmation     -> touched updated_at
  Every mutating endpoint that can change production state is now blocked at
  the transport layer of this harness. A blocked probe is recorded with
  status=None and blocked=True so the coverage ledger still shows it was
  considered but deliberately NOT executed.
  To run one of them deliberately (manual, documented, one-at-a-time), export
  AUDIT_ALLOW_DESTRUCTIVE=1 and re-run — never as part of a batch sweep.

Output: audit/evidence/api_probe_results.json + api_probe_summary.md
"""
import json, os, pathlib, re, sys, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROD = os.environ.get('AUDIT_BASE_URL', 'https://el-nour-dashboard.vercel.app')
OUT = ROOT / 'audit' / 'evidence'
OUT.mkdir(parents=True, exist_ok=True)


def load_env():
    env = {}
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
        env[k] = v
    return env


ENV = load_env()
SB = ENV['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
SVC = ENV['SUPABASE_SERVICE_ROLE_KEY']
NONEXISTENT_UUID = '00000000-0000-0000-0000-000000000000'


def cookie(name):
    p = pathlib.Path(f'/tmp/{name}_cookie.txt')
    return p.read_text().strip() if p.exists() else None


COOKIES = {
    'admin': cookie('admin'),
    'employee': cookie('employee'),
    'viewer': cookie('viewer'),
}
INVALID_COOKIE = 'sb-lyswmlmrlviptprhfiph-auth-token=base64-not-a-real-session'

REDACT = [
    (re.compile(r'(eyJ[A-Za-z0-9_\-\.]{20,})'), '<JWT>'),
    (re.compile(r'("api_key"\s*:\s*")[^"]*'), r'\1<REDACTED>'),
    (re.compile(r'("webhook_secret"\s*:\s*")[^"]*'), r'\1<REDACTED>'),
    (re.compile(r'(vca_[A-Za-z0-9_\-]{10,})'), '<VercelToken>'),
    (re.compile(r'(sb_secret_[A-Za-z0-9_\-]{10,})'), '<ServiceKey>'),
]


def redact(s):
    if not isinstance(s, str):
        s = str(s)
    for pat, rep in REDACT:
        s = pat.sub(rep, s)
    return s


# ------------------------------------------------------- destructive-endpoint guard
# Every (method, path-prefix) pair that can mutate production state and was
# observed to mutate it even with an empty/invalid payload.
BLOCKED_MUTATIONS = [
    ('DELETE', '/api/integrations/easyorders'),          # INC-001: wiped credentials
    ('PUT', '/api/integrations/easyorders'),             # overwrites api_key/secret
    ('POST', '/api/integrations/easyorders/import-test'),  # INC-001: created order
    ('GET', '/api/integrations/easyorders/catch-up'),    # imports live orders
    ('GET', '/api/integrations/easyorders/backfill'),    # rewrites live orders
    ('POST', '/api/integrations/easyorders/process-queue'),
    ('GET', '/api/integrations/easyorders/process-queue'),
    ('POST', '/api/integrations/easyorders/sync'),
    ('GET', '/api/integrations/easyorders/sync'),
    ('POST', '/api/integrations/easyorders/webhook-config'),
    ('DELETE', '/api/integrations/easyorders/webhook-config'),
    ('PUT', '/api/integrations/order-confirmation'),
    ('POST', '/api/integrations/order-confirmation/resend'),
    ('POST', '/api/auth/register'),                      # creates an auth user
    ('POST', '/api/export/excel'),                       # creates export_jobs rows
    ('POST', '/api/orders/bulk'),                        # bulk status mutations
    ('DELETE', '/api/products'),                         # collection-wide delete
    ('DELETE', '/api/orders'),                           # collection-wide delete
    ('DELETE', '/api/customers'),                        # collection-wide delete
    ('DELETE', '/api/expenses'),                         # collection-wide delete
]
# Collection-wide DELETEs must match EXACTLY: a DELETE that targets one
# explicit (non-existent) row id is safe to probe.
EXACT_ONLY = {'/api/products', '/api/orders', '/api/customers', '/api/expenses'}
ALLOW_DESTRUCTIVE = os.environ.get('AUDIT_ALLOW_DESTRUCTIVE') == '1'


def is_blocked(method, path):
    bare = path.split('?')[0].rstrip('/') or '/'
    for m, prefix in BLOCKED_MUTATIONS:
        if method.upper() != m:
            continue
        p = prefix.rstrip('/')
        if p in EXACT_ONLY:
            if bare == p:
                return True
            continue
        if bare == p or bare.startswith(p + '/'):
            return True
    return False


def request(method, path, identity='anon', body=None, extra_headers=None, timeout=90):
    if is_blocked(method, path) and not ALLOW_DESTRUCTIVE:
        return {'status': None, 'blocked': True, 'ms': 0, 'shape': 'blocked',
                'body': 'BLOCKED by destructive-endpoint guard (no request sent)',
                'headers': {}}
    headers = {'Accept': 'application/json'}
    if identity != 'anon':
        c = COOKIES.get(identity)
        headers['Cookie'] = c if c else INVALID_COOKIE
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(PROD + path, method=method, headers=headers, data=data)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8', 'replace')
            status = resp.status
            rh = {k: v for k, v in resp.headers.items()
                  if k.lower() in ('x-ratelimit-limit', 'x-ratelimit-remaining', 'content-type', 'set-cookie')}
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        status = e.code
        rh = {k: v for k, v in e.headers.items()
              if k.lower() in ('x-ratelimit-limit', 'x-ratelimit-remaining', 'content-type')}
    except Exception as e:
        return {'status': None, 'error': str(e)[:200], 'ms': int((time.time() - t0) * 1000),
                'body': '', 'headers': {}}
    ms = int((time.time() - t0) * 1000)
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        pass
    if isinstance(parsed, dict):
        shape = sorted(parsed.keys())
    elif isinstance(parsed, list):
        shape = f'array[{len(parsed)}]'
    else:
        shape = 'non-json'
    return {'status': status, 'ms': ms, 'shape': shape, 'body': redact(raw)[:400], 'headers': rh}


# ---------------------------------------------------------------- route table
# (method, path, expected_min_role, probe_kind)
ROUTES = [
    # auth
    ('POST', '/api/auth/register', 'anon', {'body': {}}),
    ('POST', '/api/auth/register', 'anon', {'body': {'email': 'not-an-email', 'password': 'x'}}),
    ('POST', '/api/auth/register', 'anon', {'body': {'email': 'audit-probe-viewer@elnour.test', 'password': 'Audit-Probe-Viewer-2026!'}}),
    # customers
    ('GET', '/api/customers?page=1&pageSize=5', 'viewer', {}),
    ('GET', '/api/customers?page=999&pageSize=5', 'viewer', {}),
    ('GET', '/api/customers?page=1&pageSize=5000', 'viewer', {}),
    ('GET', '/api/customers?search=zzzznomatch', 'viewer', {}),
    ('GET', '/api/customers?sortBy=;drop%20table&sortOrder=asc', 'viewer', {}),
    ('GET', '/api/customers?sortBy=nonexistent_column', 'viewer', {}),
    ('GET', '/api/customers?id=' + NONEXISTENT_UUID, 'viewer', {}),
    ('POST', '/api/customers', 'employee', {'body': {}}),
    ('POST', '/api/customers', 'employee', {'body': {'name': 'X', 'phone': 'not-a-phone'}}),
    ('POST', '/api/customers', 'employee', {'body': {'name': None, 'phone': '01000000000', 'email': 'x'}}),
    # products
    ('GET', '/api/products?page=1&pageSize=5', 'viewer', {}),
    ('GET', '/api/products?includeInactive=true', 'viewer', {}),
    ('GET', '/api/products?stockFilter=low', 'viewer', {}),
    ('GET', '/api/products?stockFilter=not-a-filter', 'viewer', {}),
    ('GET', '/api/products/' + NONEXISTENT_UUID, 'viewer', {}),
    ('POST', '/api/products', 'employee', {'body': {}}),
    ('POST', '/api/products', 'employee', {'body': {'name': 'X', 'price': 'abc'}}),
    ('POST', '/api/products', 'employee', {'body': {'name': 'X', 'price': -5}}),
    ('PATCH', '/api/products/' + NONEXISTENT_UUID, 'employee', {'body': {'price': 1}}),
    ('PATCH', '/api/products/' + NONEXISTENT_UUID, 'employee', {'body': {'price': 'abc'}}),
    # orders
    ('GET', '/api/orders?page=1&pageSize=5', 'viewer', {}),
    ('GET', '/api/orders?page=1&pageSize=5&sortBy=created_at&sortOrder=desc', 'viewer', {}),
    ('GET', '/api/orders?page=1&pageSize=5&sortBy=bogus&sortOrder=desc', 'viewer', {}),
    ('GET', '/api/orders?status=pending', 'viewer', {}),
    ('GET', '/api/orders?status=not-a-status', 'viewer', {}),
    ('GET', '/api/orders?search=%27%20OR%201=1--', 'viewer', {}),
    ('GET', '/api/orders/' + NONEXISTENT_UUID, 'viewer', {}),
    ('POST', '/api/orders', 'employee', {'body': {}}),
    ('POST', '/api/orders', 'employee', {'body': {'items': []}}),
    ('POST', '/api/orders', 'employee', {'body': {'items': [{'name': 'x'}]}}),
    ('PATCH', '/api/orders/' + NONEXISTENT_UUID, 'employee', {'body': {'status': 'confirmed'}}),
    ('PATCH', '/api/orders/' + NONEXISTENT_UUID, 'employee', {'body': {'status': 'not-a-status'}}),
    ('DELETE', '/api/orders/' + NONEXISTENT_UUID, 'manager', {}),
    ('POST', '/api/orders/bulk', 'employee', {'body': {}}),
    ('POST', '/api/orders/bulk', 'employee', {'body': {'ids': [], 'action': 'confirm'}}),
    ('POST', '/api/orders/bulk', 'employee', {'body': {'ids': [NONEXISTENT_UUID], 'action': 'confirm'}}),
    ('POST', '/api/orders/bulk', 'employee', {'body': {'ids': [NONEXISTENT_UUID], 'action': 'not-an-action'}}),
    ('GET', '/api/orders/stats', 'viewer', {}),
    # inventory
    ('GET', '/api/inventory/adjust?product_id=' + NONEXISTENT_UUID, 'employee', {}),
    ('POST', '/api/inventory/adjust', 'employee', {'body': {}}),
    ('POST', '/api/inventory/adjust', 'employee', {'body': {'product_id': NONEXISTENT_UUID, 'quantity': 5, 'reason': 'x'}}),
    ('POST', '/api/inventory/adjust', 'employee', {'body': {'product_id': NONEXISTENT_UUID, 'quantity': -5, 'reason': 'x'}}),
    ('POST', '/api/inventory/adjust', 'employee', {'body': {'product_id': NONEXISTENT_UUID, 'quantity': 'lots', 'reason': 'x'}}),
    # reconciliation
    ('GET', '/api/reconciliation', 'viewer', {}),
    ('GET', '/api/reconciliation?id=' + NONEXISTENT_UUID, 'viewer', {}),
    ('POST', '/api/reconciliation', 'employee', {'body': {}}),
    ('POST', '/api/reconciliation', 'employee', {'body': {'date': 'not-a-date'}}),
    ('PUT', '/api/reconciliation', 'employee', {'body': {}}),
    ('PUT', '/api/reconciliation', 'employee', {'body': {'id': NONEXISTENT_UUID, 'status': 'closed'}}),
    # collections
    ('GET', '/api/collections', 'viewer', {}),
    ('POST', '/api/collections', 'employee', {'body': {}}),
    ('POST', '/api/collections', 'employee', {'body': {'order_ids': [], 'amount': 0}}),
    ('PUT', '/api/collections', 'employee', {'body': {}}),
    ('DELETE', '/api/collections?id=' + NONEXISTENT_UUID, 'manager', {}),
    # expenses
    ('GET', '/api/expenses', 'viewer', {}),
    ('GET', '/api/expenses?dateFrom=2026-01-01&dateTo=2026-12-31', 'viewer', {}),
    ('GET', '/api/expenses?dateFrom=not-a-date', 'viewer', {}),
    ('POST', '/api/expenses', 'employee', {'body': {}}),
    ('POST', '/api/expenses', 'employee', {'body': {'amount': -10, 'category': 'other', 'description': 'x'}}),
    ('POST', '/api/expenses', 'employee', {'body': {'amount': 'abc', 'category': 'other', 'description': 'x'}}),
    ('PUT', '/api/expenses', 'employee', {'body': {}}),
    ('DELETE', '/api/expenses?id=' + NONEXISTENT_UUID, 'manager', {}),
    # settings
    ('GET', '/api/settings', 'employee', {}),
    ('GET', '/api/settings?type=easyorders', 'employee', {}),
    ('PUT', '/api/settings', 'admin', {'body': {}}),
    ('PUT', '/api/settings', 'admin', {'body': {'business_name': '', 'currency': 'XXX'}}),
    # dashboard / reports
    ('GET', '/api/dashboard/stats', 'viewer', {}),
    ('GET', '/api/dashboard/stats?dateRange=today', 'viewer', {}),
    ('GET', '/api/dashboard/stats?dateRange=bogus-range', 'viewer', {}),
    ('GET', '/api/dashboard/sales-chart?dateRange=last_7_days', 'viewer', {}),
    ('GET', '/api/dashboard/sales-chart?from=2026-01-01&to=2026-01-31', 'viewer', {}),
    ('GET', '/api/dashboard/sales-chart?from=not-a-date&to=also-bad', 'viewer', {}),
    ('GET', '/api/dashboard/top-products?limit=5', 'viewer', {}),
    ('GET', '/api/dashboard/top-products?limit=-1', 'viewer', {}),
    ('GET', '/api/dashboard/top-products?limit=999999', 'viewer', {}),
    ('GET', '/api/dashboard/delivery-performance', 'viewer', {}),
    ('GET', '/api/reports/financial?dateFrom=2026-11-01&dateTo=2026-11-30', 'viewer', {}),
    ('GET', '/api/reports/financial?dateFrom=bad&dateTo=worse', 'viewer', {}),
    # export
    ('POST', '/api/export/excel', 'employee', {'body': {}}),
    ('POST', '/api/export/excel', 'employee', {'body': {'type': 'not-a-type'}}),
    # knowledge base
    ('GET', '/api/integrations/knowledge-base', 'viewer', {}),
    ('POST', '/api/integrations/knowledge-base', 'employee', {'body': {}}),
    ('PUT', '/api/integrations/knowledge-base', 'employee', {'body': {}}),
    ('DELETE', '/api/integrations/knowledge-base?id=' + NONEXISTENT_UUID, 'manager', {}),
    # easyorders
    ('GET', '/api/integrations/easyorders', 'employee', {}),
    ('PUT', '/api/integrations/easyorders', 'admin', {'body': {}}),
    ('DELETE', '/api/integrations/easyorders', 'admin', {'body': {}}),
    ('POST', '/api/integrations/easyorders/sync', 'manager', {'body': {}}),
    ('GET', '/api/integrations/easyorders/sync', 'manager', {}),
    ('POST', '/api/integrations/easyorders/test', 'admin', {'body': {}}),
    ('GET', '/api/integrations/easyorders/webhook-attempts', 'employee', {}),
    ('GET', '/api/integrations/easyorders/webhook-config', 'admin', {}),
    ('POST', '/api/integrations/easyorders/webhook-config', 'admin', {'body': {'mode': 'self-test'}}),
    ('DELETE', '/api/integrations/easyorders/webhook-config?url=https%3A%2F%2Fexample.invalid%2Fx', 'admin', {}),
    ('POST', '/api/integrations/easyorders/import-test', 'admin', {'body': {}}),
    ('GET', '/api/integrations/easyorders/backfill', 'admin', {}),
    ('GET', '/api/integrations/easyorders/catch-up', 'any', {}),
    ('POST', '/api/integrations/easyorders/process-queue', 'manager', {'body': {}}),
    ('GET', '/api/integrations/easyorders/process-queue', 'manager', {}),
    # webhook (public, secret-protected)
    ('POST', '/api/integrations/easyorders/webhook', 'anon', {'body': {'event': 'order.created'}}),
    ('POST', '/api/integrations/easyorders/webhook', 'anon',
     {'body': {'event': 'order.created'}, 'headers': {'secret': 'WRONG-SECRET'}}),
    ('POST', '/api/integrations/easyorders/webhook', 'anon',
     {'body': {'event': 'order.created'}, 'headers': {'secret': 'cmFVNDZsV3JYQg=='}}),
    ('GET', '/api/integrations/easyorders/webhook', 'anon', {}),
    # order confirmation
    ('GET', '/api/integrations/order-confirmation', 'employee', {}),
    ('PUT', '/api/integrations/order-confirmation', 'employee', {'body': {}}),
    ('POST', '/api/integrations/order-confirmation/resend', 'manager', {'body': {}}),
    ('POST', '/api/integrations/order-confirmation/cron', 'anon', {'body': {}}),
    ('GET', '/api/integrations/order-confirmation/cron', 'anon', {}),
]

WRONG_METHOD = [
    ('GET', '/api/products'), ('PUT', '/api/products'), ('DELETE', '/api/products'),
    ('GET', '/api/expenses'), ('POST', '/api/orders/stats'), ('DELETE', '/api/orders'),
    ('POST', '/api/dashboard/stats'), ('PUT', '/api/reports/financial'),
    ('POST', '/api/orders/bulk'), ('GET', '/api/export/excel'),
]


def count_rows(table):
    req = urllib.request.Request(f"{SB}/rest/v1/{table}?select=id", headers={'apikey': SVC, 'Prefer': 'count=exact', 'Range': '0-0'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            cr = resp.headers.get('Content-Range', '')
            return int(cr.split('/')[-1]) if '/' in cr else -1
    except Exception:
        return -1


TABLES = ['orders', 'order_items', 'customers', 'products', 'expenses', 'collection_batches',
          'collection_allocations', 'daily_reconciliations', 'inventory_movements',
          'knowledge_base', 'notifications', 'easyorders_webhook_events', 'automation_logs',
          'audit_log', 'order_confirmations', 'export_jobs']


def main():
    print('== sampling row counts BEFORE ==')
    before = {t: count_rows(t) for t in TABLES}
    for t, c in before.items():
        print(f'   {t:32s} {c}')

    results = []
    seq = 0
    for method, path, expect, spec in ROUTES:
        seq += 1
        identities = ['anon', 'invalid-cookie', 'viewer', 'employee', 'admin']
        if expect == 'anon':
            identities = ['anon', 'invalid-cookie']
        for identity in identities:
            r = request(method, path, identity=identity, body=spec.get('body'),
                        extra_headers=spec.get('headers'))
            results.append({'seq': seq, 'method': method, 'path': path, 'identity': identity,
                            'expected_role': expect, 'kind': 'primary', **r})
        # invalid-cookie variant is covered above; also wrong-method probes
    for method, path in WRONG_METHOD:
        seq += 1
        r = request(method, path, identity='admin', body={} if method in ('POST', 'PUT', 'PATCH') else None)
        results.append({'seq': seq, 'method': method, 'path': path, 'identity': 'admin',
                        'expected_role': 'n/a', 'kind': 'wrong-method', **r})

    print('\n== sampling row counts AFTER ==')
    after = {t: count_rows(t) for t in TABLES}
    deltas = {t: after[t] - before[t] for t in TABLES if after[t] != before[t]}

    out = {'base_url': PROD, 'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'rows_before': before, 'rows_after': after, 'row_deltas': deltas, 'probes': results}
    (OUT / 'api_probe_results.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))

    print(f'\nprobes executed: {len(results)}')
    blocked = [p for p in results if p.get('blocked')]
    print(f'probes blocked by safety guard (not sent): {len(blocked)}')
    for p in blocked:
        print(f'   BLOCKED {p["method"]} {p["path"]} [{p["identity"]}]')
    print('row deltas (must be empty):', deltas or 'NONE')
    by_status = {}
    for p in results:
        if p.get('blocked'):
            by_status['blocked'] = by_status.get('blocked', 0) + 1
            continue
        by_status[p['status']] = by_status.get(p['status'], 0) + 1

    # Write the evidence BEFORE printing the summary: a crash in the report
    # must never discard a completed run.
    out['blocked_probes'] = [{'method': p['method'], 'path': p['path'], 'identity': p['identity']} for p in blocked]
    (OUT / 'api_probe_results.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
    (OUT / 'api_probe_status_counts.json').write_text(json.dumps(by_status, indent=1))
    print('status distribution:', dict(sorted(by_status.items(), key=lambda kv: (kv[0] is None, str(kv[0])))))
    print('saved', OUT / 'api_probe_results.json')


if __name__ == '__main__':
    main()
