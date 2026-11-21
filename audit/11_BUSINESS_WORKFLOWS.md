# Business Workflows — Order, Collection, Reconciliation and Reports

Scope: the business flows a store owner actually performs, checked end to end against the
production data and the production API.

---

## 1. Order lifecycle

```
new (EasyOrders import or manual)
   └─ pending ──► confirmed ──► preparing ──► ready_for_shipping
                    └─► shipped ──► out_for_delivery ──► delivered
                    └─► cancelled / returned / failed_delivery
```

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| WF-01 | a new order enters the system | a `pending` order + customer + product + line | 2 023 orders, 1 977 of them `pending` | PASS |
| WF-02 | an imported order is linked to its source | `source = easyorders`, `easyorders_order_id` set | every imported order carries both; 0 duplicate external ids | PASS |
| WF-03 | the order total matches its lines | exact | 2 023/2 023 | PASS |
| WF-04 | the customer counters follow the orders | exact | 1 922/1 922 on `total_orders` and `total_spent` | PASS |
| WF-05 | cancelling an order removes it from the revenue | yes | `cancelled`/`returned` are excluded from the sales aggregation in the dashboard and the financial report | PASS |
| WF-06 | the status values are from the known set | yes | 0 unknown statuses | PASS |
| WF-07 | the status history is recorded | yes | **`order_status_history` is empty** — no application-side status trail | WARN |
| WF-08 | the confirmation flow records its events | yes | `order_confirmations` / `order_confirmation_events` are empty | WARN |

The workflow itself is sound: the state machine is consistent, the counters are exact and
the money adds up. The gap is **observability** — the two event tables exist but nothing
writes to them, so the owner cannot answer "when did this order change state?".

## 2. Collections (shipping-company reconciliation)

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| WF-10 | a collection batch stores its expected amount | yes | schema is correct (`expected_amount`, `received_amount`, `status`, `batch_reference`) | PASS |
| WF-11 | allocations sum to the batch total | exact | 0 of 0 disagree (the table is currently empty) | PASS |
| WF-12 | an allocation points at a real order | yes | 0 violations | PASS |
| WF-13 | the feature is used | — | **0 batches** exist: the screen has no data and the flow was only exercised by the audit (its test rows were deleted) | WARN |

The collection flow was exercised during the audit: a batch with two orders and one
deduction was created, the arithmetic was verified, and the test rows were removed again.

## 3. Daily reconciliation

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| WF-20 | the reconciliation API answers | 200 | 200 | PASS |
| WF-21 | the arithmetic is self-consistent | `sales − cogs = profit`, `profit − returned_orders + returned_products = reconciled_profit` | 0 violations | PASS |
| WF-22 | every business day is reconciled | yes | **76 of 76 days have no reconciliation row** | WARN |
| WF-23 | COGS can be computed | yes | **all 12 products have `cost_price = 0`** → COGS = 0 | WARN |

The reconciliation screen is therefore a **shell**: it works, but it has never been closed
for a real day, and even when it is used it cannot report a gross profit until the product
costs are entered.

## 4. Reports

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| WF-30 | `/api/reports/financial` with a valid range | 200 | 200 (2 277 ms) | PASS |
| WF-31 | the same route with a malformed date | 400 | was **500** → now 400 | PASS (fixed, F-002) |
| WF-32 | the report and the dashboard agree on the period | yes | both use the shared `resolveDateRange` (Africa/Cairo) after the repair | PASS (fixed) |
| WF-33 | the report reflects the day boundaries | yes | `resolveDateRange` was extracted into `src/lib/date-range.ts` and is now used by the dashboard, the sales chart and the financial report | PASS (fixed) |
| WF-34 | the top-products ranking is bounded | yes | `limit` is validated (1–100) | PASS (fixed, F-003) |

## 5. Exports as a business artefact

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| WF-40 | the export contains the rows the screen shows | yes | **503 rows exported vs 506 shown** (three orders from the first two hours of 2026-11-01 Cairo time are missing) → **506/506 after the fix** | PASS (fixed, F-017) |
| WF-41 | the export is restricted | employee+ | viewer → 403 | PASS |
| WF-42 | the export formats | xlsx + csv | xlsx 540 750 bytes / csv 18 545 bytes with a UTF-8 BOM and Arabic headers | PASS |
| WF-43 | the export does not write to the database | no rows | the route reads through the RLS client and builds the workbook in memory | PASS |
| WF-44 | the file name is usable | yes | the RFC 5987 name is correct (`orders_20_%D9%86%D9%88…`), the ASCII fallback degrades to `orders_20________2026.xlsx` | PARTIAL (cosmetic) |

## 6. Settings, users and notifications

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| WF-50 | the settings screen loads | 200 | 200, 16 fields | PASS |
| WF-51 | the settings are role-gated | yes | employee+ (F-014 — owner decision) | NEEDS-VALIDATION |
| WF-52 | the notification centre works | yes | 1 notification (`order_delivered`, EO-261106-3538) | PASS |
| WF-53 | notifications are created for new orders | yes | only 1 notification exists for 2 023 orders → the notification writer is not wired to the import path | WARN |

## 7. Summary of the workflow findings

| Severity | Item | Type |
|---|---|---|
| medium | F-017 — the export and the list disagree on the period | consistency |
| low | 76/76 business days are not reconciled | feature not adopted |
| low | all products have `cost_price = 0` → no COGS | data completeness |
| low | `order_status_history` and `order_confirmation_events` stay empty | observability |
| low | notifications are not produced by the import path | observability |
| low | the collections feature has never been used | feature not adopted |
| low | F-014 — the settings role gate | owner decision |
