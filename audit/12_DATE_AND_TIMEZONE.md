# Date, Time-Zone and Calendar Semantics

Scope: every place where a date is interpreted — the order list, the dashboard, the sales
chart, the financial report, the top-products ranking, the reconciliation screen and the
export.

**Reference time zone: Africa/Cairo** (EET, UTC+2; the store operates in Egypt).

---

## 1. Why this unit exists

Before the repair, the application had **two independent calendar implementations**:

* `src/app/api/dashboard/sales-chart/route.ts` carried its own copy of the preset maths and
  worked in the **server's local time**;
* `src/app/api/orders/route.ts` used a different parameter contract.

The result: the dashboard cards and the orders table could describe **different sets of
orders** for the same filter — the most dangerous class of bug in a business application,
because both numbers look right.

## 2. The shared engine

The repair consolidated the logic into `src/lib/date-range.ts`:

```
resolveDateRange({ dateRange | from | to })
  dateRange: today | yesterday | this_week | this_month | last_month | all | custom
  → { from: ISO timestamp | null, to: ISO timestamp | null }
```

The boundaries are computed on the **Africa/Cairo calendar** and returned as UTC
timestamps, so the database comparison (`created_at` is `timestamptz`) is exact.

The following routes now use it: `/api/orders`, `/api/orders/stats`,
`/api/dashboard/stats`, `/api/dashboard/sales-chart`, `/api/dashboard/top-products`,
`/api/reports/financial`, `/api/reconciliation`.

## 3. Checks

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| TZ-01 | `dateRange=today` covers the Cairo day, not the UTC day | 00:00–23:59:59 Cairo | `GET /api/dashboard/stats?dateRange=today` → `today_orders: 29`; the direct query with the Cairo bounds returns the same 29 rows | PASS |
| TZ-02 | the month preset covers the Cairo month | yes | `dateRange=this_month` on 2026-11-20 → the Cairo month, not the UTC month | PASS |
| TZ-03 | an order created at 23:30 Cairo belongs to that day | yes | the Cairo window covers 22:00–24:00 UTC of the previous day | PASS |
| TZ-04 | a malformed date is rejected | 400 | was **500** → now 400 on the sales chart, the financial report and the expenses route | PASS (fixed, F-002) |
| TZ-05 | a reversed range is rejected | 400 | `dateFrom > dateTo` → 400 | PASS |
| TZ-06 | an out-of-range date is rejected | 400 | `2026-99-99` → 400 | PASS |
| TZ-07 | the sales chart buckets by the Cairo day | yes | the buckets are built from `businessDateString` (the Cairo calendar day) | PASS (fixed) |
| TZ-08 | the chart response says which range it used | yes | the route returns the resolved `range` | PASS (fixed) |
| TZ-09 | the expense filter compares a DATE column correctly | yes | `expenses.expense_date` is a `DATE`, so the bound is truncated to `YYYY-MM-DD` before the comparison | PASS |
| TZ-10 | the list and the export use the same boundaries | yes | **the export uses raw timestamps → 3 rows missing (F-017)** | FAIL (open) |
| TZ-11 | the reconciliation day is the Cairo day | yes | `/api/reconciliation?date=2026-11-20` resolves the Cairo day | PASS |

## 4. The F-017 measurement

| Window | Semantics | Orders |
|---|---|---|
| `2026-11-01T00:00:00Z … 2026-11-21T23:59:59Z` | raw ISO (what the **export** applies) | 503 |
| `2026-10-31T22:00:00Z … 2026-11-21T21:59:59Z` | Cairo days (what the **list** applies) | 506 |

The three orders in the difference were created between 00:00 and 02:00 Cairo time on
2026-11-01 — exactly the orders a store owner would check first in a monthly export:

* `EO-261111-7913` (2026-10-31T23:06:55Z)
* `EO-261111-1935` (2026-10-31T22:59:16Z)
* `EO-261111-9264` (2026-10-31T22:38:20Z)

**Fix (prepared):** route the export filters through `resolveDateRange` before building
the query, exactly like the list route does.

## 5. What is correct today

* The server runs in UTC (Vercel), so every persisted timestamp is unambiguous.
* All business-day logic is computed on the Cairo calendar, in one place.
* The dashboard, the list and the reports agree — the sales chart, the stats cards and the
  financial report now describe the same set of orders.
* `expenses.expense_date` (a `DATE`) is compared with a date-only bound; mixing a
  timestamp with a DATE column was the classic off-by-one-hour error and it is avoided.

## 6. Residual risks

1. **The export still applies raw timestamps** (F-017) — the one place where the shared
   engine is not used.
2. **Egypt observes DST.** The engine resolves the calendar day through the IANA
   `Africa/Cairo` zone, so a DST switch changes the UTC bounds automatically. Any future
   code that hard-codes `+02:00` would break twice a year.
3. `daily_reconciliations.business_date` is a `DATE` column: a day is a Cairo day only by
   convention. The convention is not written down in the schema — a comment or a check
   constraint would make it explicit.
