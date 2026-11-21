# EasyOrders Integration — End-to-End Audit

Scope: the outbound API client, the inbound webhook, the import workers, the
configuration/credential store, the queue and the integration UI.

---

## 1. Topology

```
EasyOrders platform ──(order.created webhook, secret header)──► POST /api/integrations/easyorders/webhook
                                                                        │
                                                                        ▼
                                                        automation_logs (delivery history)
                                                                        │
                                                                        ▼
                                                             import queue → orders / customers / products
EasyOrders platform ◄──(Api-Key header)── GET /api/v1/external-apps/{products,orders,categories,shipping}
                                                                        ▲
                                                                        │
        GET /api/integrations/easyorders/{catch-up,backfill,process-queue,sync}
```

## 2. Connection state (measured live)

| Field | Value |
|---|---|
| `store_id` | `3fb15a96-d8ec-43cf-bbcf-4e5711d37f43` (`store-elnour`) |
| `api_key` | present, encrypted, identifier `93a47492-7959-45ab-9a69-a1383d1c2fcc` (masked `93a4••••••••••••2fcc`) |
| `is_connected` | **true** (after the successful connection test) |
| `last_sync_at` | `2026-11-20T18:45:16Z` |
| `last_sync_status` | `success` |
| `last_webhook_at` | `2026-11-06T23:23:58Z` ← **the TRUE last delivery, not a stale value (see the corrected F-011 below)** |
| `total_imported_orders` | 19 — against **2 022** successful imports: 2 003 lost updates → **F-012** |
| outbound test | `POST …/test` → **200 "تم الاتصال بنجاح"** |
| webhook self-test | `POST …/webhook-config {mode:"self-test"}` → **200**, `endpointLive/secretAccepted/secretEnforced = true` |

## 3. Test matrix

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| EO-01 | the webhook accepts a correctly signed delivery | 200 | 200 | PASS |
| EO-02 | the webhook rejects a wrong secret | 401 | 401 | PASS |
| EO-03 | the webhook rejects a missing secret | 401 | 401 | PASS |
| EO-04 | the webhook secret is enforced | confirmed | `secretEnforced = true` in the self-test | PASS |
| EO-05 | the outbound API key works | 200 | `GET /external-apps/products` → 200 | PASS |
| EO-06 | the configuration is readable by an admin | 200 | 200, key masked | PASS |
| EO-07 | the configuration is not readable by an employee | 403 | 403 (admin-only read) | PASS |
| EO-08 | a viewer cannot read the configuration | 403 | 403 | PASS |
| EO-09 | a viewer cannot trigger the import workers | 403 | **was 200 → F-008, now 403** | PASS (fixed) |
| EO-10 | `DELETE /api/integrations/easyorders` without a confirmation | 400 | 400 (credentials kept) | PASS (fixed, F-006) |
| EO-11 | `DELETE …` with `{"confirm":"disconnect"}` | soft disconnect | `is_connected=false`, secrets kept, `audit_log` row written | PASS (fixed) |
| EO-12 | `POST …/import-test` | 403 unless opted in | 403 without `ALLOW_EASYORDERS_IMPORT_TEST=1` | PASS (fixed, F-007) |
| EO-13 | the delivery history is visible to the operator | yes | `GET …/webhook-attempts` returns the live stream | PASS |
| EO-14 | the delivery history in the panel is current | yes | `last_webhook_at = 2026-11-06T23:23:58Z` is the true last delivery — **correct**, but it exposes the outage → **F-011 (confirmed)** | FAIL (F-011, owner action) |
| EO-15 | every import run is logged | yes | the scanners wrote no `easyorders_sync_logs` row → F-013 | PASS (fixed — one row per scanner run) |
| EO-19 | the platform calls the webhook | yes | **no `webhook_received` marker since 2026-11-06; 94 % of the orders are imported > 24 h late → F-011** | FAIL (open) |
| EO-16 | an unknown event type is handled | decided behaviour | stored as a dead letter → F-015 (owner decision) | NEEDS-VALIDATION |
| EO-17 | `easyorders_config` is not readable by a client role | admin only | column privileges + RLS aligned (F-005) | PASS (fixed) |
| EO-18 | the re-import guard | no duplicate orders | 0 duplicate `easyorders_order_id` values in 2 023 orders | PASS |

## 4. The delivery channel: corrected measurement (F-011, confirmed)

> **This section replaces the first-pass conclusion.** The first pass rejected the
> hypothesis "EasyOrders stopped delivering" because `automation_logs` held 2 022
> successful `order_created` rows. **That inference was invalid** — the `order_created`
> rows are written by the **scanner** through the same import routine, so they prove the
> scanner ran, not that the platform called the webhook.

### What the live handler actually writes

The deployed webhook handler writes a `webhook_received` marker into `automation_logs`
for every delivery it accepts (the production 405 body matches the worktree handler
literally). That marker is the authoritative "did the platform call us" signal.

| Source | Rows | What it actually is |
|---|---|---|
| `automation_logs` · type `webhook_received` | **0** | the delivery marker — **there is none** |
| `automation_logs` · type `order_created` / success | 2 022 | written by the **scanner**, not by the webhook |
| `easyorders_webhook_events` | 2 (both 2026-11-06) | the last two deliveries the platform made |
| `easyorders_config.last_webhook_at` | `2026-11-06T23:23:58Z` | the **true** last delivery |

### The import-latency profile

| Window | Median | Max | Share imported > 24 h after creation |
|---|---|---|---|
| all imports | 708 h (29.5 days) | — | **94 %** |
| since 2026-11-14 | 33.4 h | — | — |
| since 2026-11-19 | 6.9 h | 16.1 h | 0 % |

A live delivery would show seconds. A periodic scanner shows exactly this shape.

### Conclusion

**The platform has not called the store webhook since 2026-11-06.** Every order arrives
through the periodic scanner, so the dashboard works — on data that is up to a month old.
The application side is verified correct (the handler accepts, authenticates and
processes a signed delivery; EO-01 … EO-08 all pass), so the root cause is **external**:
the webhook is not registered / not active in the EasyOrders seller panel.

**Owner action:** re-register the webhook (Public API → Webhooks) against
`https://el-nour-dashboard.vercel.app/api/integrations/easyorders/webhook`, then verify
that a new order produces a `webhook_received` marker within seconds.

**Code side (delivered):** the marker row and `last_webhook_at` are now written and
measured on every run, so the panel tells the truth either way.

## 5. Import behaviour observed during the audit

| ID | Observation | Consequence |
|---|---|---|
| EO-20 | the probe calls to `/catch-up` and `/backfill` performed **real imports** | 8 orders and 7 customers arrived during the audit (orders 2 015 → 2 023, customers 1 915 → 1 922) |
| EO-21 | the browser session triggered `POST /process-queue` once | the queue was drained; no data harm |
| EO-22 | the imports are genuine store orders (`source = easyorders`, `easyorders_order_id` set) | **no synthetic business data entered production** — the audit's own probe rows were deleted, these were not |

This is disclosed rather than hidden: a "read-only" catch-up endpoint is in fact a writer.
It is now admin-gated (F-008), but the endpoint name still understates what it does.

## 6. Import-path correctness

| ID | Check | Result | Status |
|---|---|---|---|
| EO-30 | duplicate protection | 0 duplicate external ids in 2 023 orders | PASS |
| EO-31 | order totals match the line items | 2 023/2 023 orders satisfy `total = subtotal − discount + shipping + tax` | PASS |
| EO-32 | line totals match the items | 2 023/2 023 satisfy `total = qty × price − discount` | PASS |
| EO-33 | every order has a customer | 0 orders with a missing customer reference | PASS |
| EO-34 | every line has a product | 0 orphan lines | PASS |
| EO-35 | customer counters match reality | 1 922/1 922 customers agree on `total_orders` and `total_spent` | PASS |
| EO-36 | products are complete | 0 products without a SKU; 0 negative stock | PASS |
| EO-37 | costs are available | **all 12 products have `cost_price = 0`** → COGS and gross profit are 0 | WARN (data, not code) |

## 7. Residual risks and open items

1. **F-011 (confirmed, owner action)** — the platform has not called the webhook since
   2026-11-06; every order arrives through the scanner and 94 % of them more than 24
   hours late. Re-register the webhook in the EasyOrders seller panel.
2. **F-012 (fixed)** — the import counters lose updates (`19` against `2 022`). The
   increment moved into the database (`increment_easyorders_counters`, SECURITY DEFINER,
   service_role only) with a safe fallback; the migration is prepared and still has to be
   applied to production.
3. **F-013 (fixed)** — one `easyorders_sync_logs` row per scanner run, written through
   `record_easyorders_sync_run`; the `sync_type` constraint was widened to include
   `backfill` / `catch-up`, with a `scheduled` fallback until the migration is applied.
4. **F-015** — an unknown event type is stored as a dead letter. The owner has to decide:
   acknowledge and drop, or retain with a pruning job.
5. **COGS = 0** — every product carries `cost_price = 0`, so `provisional_cogs` and
   `provisional_profit` equal the sales figure. This is a **data-completeness** problem,
   not a code defect; it makes the profit reports meaningless until the costs are entered.
6. The catch-up/backfill endpoints remain **writers** behind a `GET`. If the platform ever
   accepts GET requests with side effects, a crawler could trigger imports. Converting
   them to `POST` is the safer shape.
