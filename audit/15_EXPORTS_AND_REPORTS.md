# Exports and Reports

Scope: `POST /api/export/excel` (xlsx + csv), the orders list as the reference view, the
financial report and the reconciliation report.
Raw data: `audit/evidence/export_probe.json`.

---

## 1. Export checks

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| EXP-01 | the export contains the rows the screen shows | same row set | **503 exported vs 506 shown** → **506 exported vs 506 shown** after the fix | PASS (fixed, F-017) |
| EXP-02 | the export is role-gated | employee+ | viewer → **403** | PASS |
| EXP-03 | the CSV format works | Arabic headers, UTF-8 | 200, `text/csv`, 18 545 bytes, UTF-8 BOM + Arabic header row | PASS |
| EXP-04 | the customers export works | a workbook | 200, 1 208 607 bytes | PASS |
| EXP-05 | the products export works | a workbook | 200, 25 291 bytes | PASS |
| EXP-06 | the method contract is explicit | POST only | `GET` → 405 | PASS |
| EXP-07 | the file name is usable | a readable name | the RFC 5987 name is correct; the ASCII fallback drops the Arabic month (`orders_20________2026.xlsx`) | PARTIAL |
| EXP-08 | the export does not modify data | no writes | the route reads through the RLS client and builds the workbook in memory | PASS |
| EXP-09 | the export is paginated internally | yes | `fetchAllRows` pages the query (PostgREST caps at 1 000 rows) | PASS |
| EXP-10 | the export respects the filters | status / customer / date / explicit ids | all filter branches present; `orderIds` is capped at 200 | PASS |
| EXP-11 | the export is bounded by the rate limiter | yes | `X-RateLimit-Limit: 30` on the write class | PASS |

## 2. The row-count disagreement (F-017)

| ID | Item | Value |
|---|---|---|
| 1 | the filter that was used | `2026-11-01` → `2026-11-21` |
| 2 | `GET /api/orders` with that filter | `total = 506` |
| 3 | the exported workbook | 504 sheet rows = 1 header + **503 data rows** |
| 4 | the service-role count with raw ISO bounds | 503 |
| 5 | the service-role count with Cairo-day bounds | 506 |
| 6 | the three missing orders | `EO-261111-7913`, `EO-261111-1935`, `EO-261111-9264` — all created between 00:00 and 02:00 **Cairo** time on 2026-11-01 |

**Root cause:** the list route resolves the range through the shared Africa/Cairo engine
(`resolveDateRange`), while the export compares the raw strings it receives. The two
therefore describe different windows.

**Fix applied (working tree, not deployed):** the export resolves the range **once** through
`resolveDateRange` and reuses those bounds in all three branches (orders, order items,
financial). The values are normalised first — a day-only value stays a Cairo business day,
an ISO instant is mapped to the Cairo day that contains it — and a value that cannot be
parsed is rejected with **HTTP 400 `invalid_date_range`** instead of silently widening the
export to "every order". Verified by `scripts/verify-export-bounds.cjs`
(`audit/evidence/export_bounds_probe.json`): **506/506, 1329/1329 and 43/43** rows identical
to the list endpoints, and an invalid bound returns 400.

**Impact:** a store owner who exports "November" and reconciles against the screen loses
the first orders of the month without any error. On a larger dataset the gap scales with
the number of orders created between midnight and 02:00 Cairo time.

**Fix (prepared):**

```ts
// src/app/api/export/excel/route.ts
const range = resolveDateRange({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
if (range.from) query = query.gte('created_at', range.from)
if (range.to)   query = query.lte('created_at', range.to)
```

## 3. Report endpoints

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| RPT-01 | `/api/reports/financial` with a valid range | 200 | 200 (2 277 ms) | PASS |
| RPT-02 | `/api/reports/financial` with a malformed date | 400 | was **500** → now 400 | PASS (fixed) |
| RPT-03 | the financial report uses the Cairo day boundaries | yes | `resolveDateRange` after the repair | PASS (fixed) |
| RPT-04 | `/api/reconciliation?date=…` | 200 | 200 | PASS |
| RPT-05 | `/api/reconciliation?list=1` | 200 | 200 (empty list — no reconciliation has ever been closed) | PASS |
| RPT-06 | the dashboard and the financial report agree | yes | both resolve the range through the shared engine | PASS (fixed) |
| RPT-07 | the reports can express a gross profit | yes | **COGS is 0 for every product** → `provisional_profit = total_sales` | WARN (data) |

## 4. The report that cannot yet be trusted

`GET /api/dashboard/stats?dateRange=today` (production, 2026-11-20) returns:

```json
{ "total_orders": 2023, "today_orders": 29,
  "total_sales": 9540, "provisional_cogs": 0, "provisional_profit": 9540,
  "expenses_total": 0, "collections_received": 0, "collections_outstanding": 0,
  "outstanding_payments": 9540, "aov": 328.97 }
```

`provisional_profit` equals `total_sales` because every product carries `cost_price = 0`
(DB-16) — the calculation is correct, the **input data** is missing. The same applies to
the financial report and to the reconciliation screen (which needs both COGS and the daily
closing rows).

## 5. Recommendations

| Priority | Action | Why |
|---|---|---|
| 1 | ~~route the export filters through `resolveDateRange`~~ **done** | the export now matches the screen (F-017): 506/506 · 1329/1329 · 43/43 (`audit/evidence/export_bounds_probe.json`) |
| 2 | enter the product costs | without them every profit figure is the revenue |
| 3 | close the daily reconciliation once a day | the reconciliation screen has no data for any of the 76 business days |
| 4 | add an ASCII-safe fallback file name | `orders_2026-11-20.xlsx` instead of `orders_20________2026.xlsx` |
| 5 | show the row count in the export response header | the client could compare `X-Row-Count` with the list total |
