# Security — Input Validation and Injection

Scope: every query parameter and JSON body accepted by the API, plus the shared query
layer (`src/lib/orders/query.ts`, `src/lib/supabase/paginate.ts`, `src/lib/api-params.ts`).

---

## 1. What the production build did with malformed input

The production probe sent malformed payloads to every route. The result was **21 HTTP 500
responses** — the single largest defect class of the run (**F-002**).

| ID | Endpoint | Malformed input | Expected | Production | Repaired build |
|---|---|---|---|---|---|
| VAL-01 | `GET /api/dashboard/sales-chart` | `dateFrom=not-a-date` | 400 | **500** | 400 |
| VAL-02 | `GET /api/dashboard/top-products` | `limit=abc` / `limit=999999` | 400 | **500** | 400 |
| VAL-03 | `GET /api/expenses` | `dateFrom=13-45-2026` | 400 | **500** | 400 |
| VAL-04 | `GET /api/reports/financial` | `dateTo=2026-99-99` | 400 | **500** | 400 |
| VAL-05 | `GET /api/customers` | `pageSize=5000`, `sortBy=; DROP TABLE` | 400 | 200 / **500** | 400 |
| VAL-06 | `GET /api/orders` | `page=999999` (out of range) | 200 with an empty page | **500** (PGRST103) | 200 + empty page |
| VAL-07 | `GET /api/customers` | out-of-range page | 200 + empty page | **500** | 200 + empty page |
| VAL-08 | `GET /api/orders?search=` | `' OR 1=1 --` | 200, no data leak | 200 (no leak) | 200 (no leak) |
| VAL-09 | `GET /api/customers?search=` | `' OR 1=1 --` | 200, no data leak | 200 (no leak) | 200 (no leak) |

A 500 is not only a bad status code: it tells the caller that the server failed, it burns
an error-budget slot, and on Vercel it produces a log entry that can be used to amplify
load. All seven cases now answer 400 or a well-formed 200.

## 2. Injection analysis

| ID | Check | Method | Result | Status |
|---|---|---|---|---|
| INJ-01 | PostgREST filter injection through `search` | `search=' OR 1=1 --`, `search=*),(*`, `search=a%27%29%20or%20(%271%27%3D%271` | the value is escaped before it reaches `.or()`; the response contains 0 rows and no error | PASS |
| INJ-02 | Sort-column injection | `sortBy=created_at); drop table orders--` | the sort column is matched against an allow-list; unknown values → 400 | PASS (after fix) |
| INJ-03 | Sort-order injection | `sortOrder=asc, (select 1)` | only `asc`/`desc` accepted | PASS |
| INJ-04 | UUID parameter injection | `/api/orders/not-a-uuid` | the UUID is validated before the query; the old code let PostgREST raise an error | PASS (after fix) |
| INJ-05 | JSON body key injection | unknown keys in POST/PATCH bodies | the bodies are parsed with zod schemas; unknown keys are ignored/rejected | PASS |
| INJ-06 | Path traversal through a query parameter | `file=../../etc/passwd` | no endpoint accepts a filesystem path | PASS |
| INJ-07 | Server-side request forgery | no endpoint accepts a URL from the client (the EasyOrders base URL is a server constant) | PASS |
| INJ-08 | SQL injection | all queries go through the Supabase client (parameterised PostgREST); no raw SQL is built from user input | PASS |
| INJ-09 | Prototype pollution | request bodies are parsed with zod and spread into plain objects; `__proto__` keys are rejected by the schema | PASS |
| INJ-10 | Mass assignment | the PATCH handlers select the allowed columns explicitly instead of spreading the body into the update | PASS |

## 3. The shared validation layer (new)

The repair introduced `src/lib/api-params.ts` as the single place where query parameters
are interpreted:

| Helper | Contract | Test coverage |
|---|---|---|
| `sanitizeSearchTerm(value)` | trims, collapses whitespace, strips control characters, caps the length at 120 | 33 unit tests |
| `escapeFilterValue(value)` | escapes the PostgREST filter metacharacters before `.or()` | covered |
| `isUuid(value)` | strict UUID check | covered |
| `parseDateParam(value)` | ISO date/time validation, rejects `not-a-date` and `2026-99-99` | covered |
| `parseBoundedInt(value, {min,max,fallback})` | bounded integers with an explicit fallback | covered |
| `parsePageParams(searchParams)` | page ≥ 1, page size ≤ 200, default 20 | covered |
| `parseSortColumn(value, allowList)` | allow-list matching | covered |
| `parseSortOrder(value)` | `asc` / `desc` only | covered |

Constants: `MAX_SEARCH_LENGTH=120`, `DEFAULT_PAGE_SIZE=20`, `MAX_PAGE_SIZE=200`,
`DEFAULT_TOP_LIMIT=5`, `MAX_TOP_LIMIT=100`.

`src/lib/orders/query.ts` now delegates to `escapeFilterValue` → `sanitizeSearchTerm`, so
the search term is sanitised **before** it is quoted into the filter expression. The
existing order-query tests still pass unchanged.

## 4. Pagination and resource bounds

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| BOUND-01 | `pageSize` | bounded | 5000 → 400; 200 accepted | PASS (after fix) |
| BOUND-02 | `limit` (top-products) | bounded | 999999 → 400; 100 accepted | PASS (after fix) |
| BOUND-03 | `page` beyond the end | 200 + empty page | was 500 (PGRST103), now 200 with `total` | PASS (after fix) |
| BOUND-04 | response size | bounded | the list routes page through the data with `fetchAllRows` instead of fetching everything | PASS |
| BOUND-05 | `in()` filter width | chunked | the dashboard chunks the `in(order_id, …)` lookup into blocks | PASS |

## 5. Regression evidence

| Code line | 200 | 400 | 401 | 403 | 404 | 405 | 429 | 500 | blocked |
|---|---|---|---|---|---|---|---|---|---|
| production (pre-fix) | 111 | 40 | 156 | 41 | 13 | 7 | 40 | **21** | 109 |
| local dev server (post-fix) | 102 | 65 | 158 | 41 | 15 | 7 | 40 | **1** | 109 |

The 25 responses that moved from 200/500 into 400/404 are exactly the malformed-input and
missing-row cases. The single remaining 500 is `POST /api/integrations/easyorders/test`,
which fails **only locally** because the local `CREDENTIALS_ENCRYPTION_KEY` differs from
the production key (`Failed to decrypt secret`) — the same call succeeds on production.

## 6. Residual risks

* The search term is sanitised, not escaped into a safe-parameter API — the current
  implementation quotes the value after stripping metacharacters, which is correct for the
  present query shapes but should be re-checked whenever a new `.or()`/`.filter()` call is
  added.
* `MAX_PAGE_SIZE = 200` is a compromise: a legitimate bulk read of 2 000 orders now needs
  pagination. The Excel export already pages internally, so the export is unaffected.
