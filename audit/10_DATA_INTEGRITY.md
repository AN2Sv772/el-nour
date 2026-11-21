# Data Integrity — Schema, Constraints and Accounting

Scope: the production database (Supabase project `lyswmlmrlviptprhfiph`) read through the
service-role REST interface. The checker is `audit/evidence/db_integrity_check.py` and it
is **read-only** (no INSERT/UPDATE/DELETE). The result is stored in
`audit/evidence/db_integrity_report.json`.

---

## 1. Dataset under review (final state, 2026-11-20 ~21:05 Cairo)

| Table | Rows | Table | Rows |
|---|---|---|---|
| orders | 2 023 | order_confirmations | 0 |
| order_items | 2 023 | order_confirmation_events | 0 |
| customers | 1 922 | order_status_history | 0 |
| products | 12 | easyorders_config | 1 |
| knowledge_base | 4 | easyorders_sync_logs | 8 |
| notifications | 1 | easyorders_webhook_events | 2 |
| expenses | 0 | automation_logs | 2 022 |
| collection_batches | 0 | audit_log | 6 |
| collection_allocations | 0 | user_profiles | 3 |
| daily_reconciliations | 0 | inventory_movements | 0 |

Order status distribution: `pending` 1 977 · `confirmed` 46 · all other states 0.

## 2. Integrity checks — 25 PASS · 0 FAIL · 3 WARN

| ID | Check | Result | Status |
|---|---|---|---|
| DB-01 | line items without a parent order | 0 | PASS |
| DB-02 | orders pointing at a missing customer | 0 | PASS |
| DB-03 | orders without a customer reference | 0 | PASS |
| DB-04 | orders without any line item | **1** (`EO-261120-19N8KU`) | **WARN** |
| DB-05 | line items pointing at a missing product | 0 | PASS |
| DB-06 | duplicate order numbers | 0 | PASS |
| DB-07 | duplicate EasyOrders external ids | 0 | PASS |
| DB-08 | `total = subtotal − discount + shipping + tax` | 2 023/2 023 | PASS |
| DB-09 | `line total = qty × price − discount` | 2 023/2 023 | PASS |
| DB-10 | negative quantities | 0 | PASS |
| DB-11 | negative unit prices | 0 | PASS |
| DB-12 | duplicate customer phone numbers | 0 | PASS |
| DB-13 | `customers.total_orders` equals the real order count | 1 922/1 922 | PASS |
| DB-14 | `customers.total_spent` equals the summed order value | 1 922/1 922 | PASS |
| DB-15 | products without a SKU | 0 | PASS |
| DB-16 | products with `cost_price = 0` | **12 of 12** | **WARN** |
| DB-17 | negative stock quantity | 0 | PASS |
| DB-18 | tracked products with negative stock | 0 | PASS |
| DB-19 | orders with an unknown status | 0 | PASS |
| DB-20 | negative expense amounts | 0 (no expense rows) | PASS |
| DB-21 | expenses with an unknown category | 0 | PASS |
| DB-22 | collection allocations without a parent batch | 0 | PASS |
| DB-23 | batch total equals the sum of its allocations | 0 of 0 disagree | PASS |
| DB-24 | allocations pointing at a missing order | 0 | PASS |
| DB-25 | daily reconciliation arithmetic | 0 of 0 disagree | PASS |
| DB-26 | business days with orders but no reconciliation row | **76 of 76** | **WARN** |
| DB-27 | `user_profiles.role` holds a known role | 0 violations | PASS |
| DB-28 | `audit_log` is populated and immutable | 6 rows; `DELETE` → 42501 | PASS |

## 3. The three warnings

### DB-04 — one order without a line item

`EO-261120-19N8KU` (580 EGP, 2 × "مساحة ارضيات ببخاش", customer "Alaa Moshen",
`source = easyorders`, `easyorders_order_id = 7ef8a2cd-…`) stores its line items **inside
the `items` JSON column** of the order row, while the other 2 022 orders use the
`order_items` table. The order is complete — the two storage models simply coexist.

| ID | Check | Observed | Status |
|---|---|---|---|
| DB-04a | how many orders carry an inline `items` array | 1 of 2 023 | INFO |
| DB-04b | does the inline sum equal the order subtotal | 520 = 520 | PASS |
| DB-04c | do orders with inline items also have `order_items` rows | no (the two sets are disjoint) | INFO |

**Risk:** every report that aggregates `order_items` (COGS, product ranking, quantities
sold) silently skips this order. It is one order today; it becomes a reporting blind spot
if the import path keeps producing inline-item orders.

**Recommendation:** one canonical storage model — the import should always write
`order_items` rows (and keep the JSON column only as a cached copy).

### DB-16 — every product has `cost_price = 0`

All 12 products carry a zero cost price, so:

* `provisional_cogs` = 0 on the dashboard;
* `provisional_profit` = `total_sales` (the API currently reports `total_sales: 9540`,
  `provisional_cogs: 0`, `provisional_profit: 9540` for today);
* the financial report shows a gross profit that is really just the revenue.

This is **data completeness, not a code defect** — the code sums `unit_cost` correctly and
the order lines carry `unit_cost = 0` because the products do. Until the costs are entered
in the products screen, every profit figure in the application is misleading. This was
also the reason the audit did not "fix" the COGS by inventing values.

### DB-26 — the daily reconciliation feature is unused

76 distinct business days carry orders; **none** of them has a row in
`daily_reconciliations`. The reconciliation screen (and its API) therefore has no data to
show for any historical day. The feature was exercised during the audit and removed again
(the audit-created row was deleted during cleanup).

**Recommendation:** either run the reconciliation daily as a closing routine, or remove
the screen from the navigation so the owner does not expect data that will never exist.

## 4. Referential and structural notes

* `order_items.order_id` and `orders.customer_id` are consistent for every row.
* `inventory_movements`, `order_confirmations`, `order_confirmation_events` and
  `order_status_history` are **empty** — these tables exist but nothing writes to them.
  `order_status_history` in particular means the application has no order-status audit
  trail of its own (the EasyOrders delivery history in `automation_logs` is the closest
  thing).
* `audit_log` holds 6 rows, all created by the audit itself; it cannot be pruned
  (SQLSTATE 42501) — an intentional immutability control.
* `easyorders_webhook_events` (2 rows, both 2026-11-06) holds the last two deliveries
  the platform made; the live delivery path is **not** running, because
  `automation_logs` contains **zero** `webhook_received` markers (the marker the live
  handler writes on every accepted delivery) → **F-011 (confirmed)**.
* `easyorders_config.total_imported_orders = 19` against **2 022** successful
  `order_created` rows — 2 003 lost updates (99.1 %) caused by the read-modify-write in
  `stampEasyOrdersSync()` → **F-012 (fixed: atomic increment)**.

## 5. What the audit changed in the database

| Action | Rows | Rule |
|---|---|---|
| deleted | 4 | synthetic order / customer / product / line item created by run 1 |
| deleted | 3 | `AUDIT-TEST` collection batch + its allocation |
| deleted | 1 | `AUDIT-TEST` expense (already voided) |
| deleted | 1 | audit-created reconciliation row |
| deleted | 4 | webhook dead-letter events created by the probes |
| deleted | 18 | `webhook_rejected` probe rows in `automation_logs` |
| **deleted** | **0** | **real business rows** |
| modified | 0 | real business rows |
| imported by the audit | 8 + 7 | genuine EasyOrders orders / customers (through the catch-up endpoint) |

The cleanup script and the before/after counts are in
`audit/evidence/cleanup_audit_residue.py` and `cleanup_report.json`.
