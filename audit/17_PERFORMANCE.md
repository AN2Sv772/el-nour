# Performance

Measurements were taken against the **production** build on 2026-11-20 with the admin
identity, from the probe harness (89 timed admin requests) and from targeted `curl`
measurements. Raw data: `audit/evidence/performance_probe.json`.

---

## 1. Latency distribution (89 admin requests)

| Percentile | Latency |
|---|---|
| min | 265 ms |
| p50 | 957 ms |
| p90 | 1 962 ms |
| p95 | 2 277 ms |
| max | 6 036 ms |

## 2. Slowest endpoints

| Endpoint | ms | Note |
|---|---|---|
| `GET /api/dashboard/stats` | **6 036** | cold request after the deployment warmed up |
| `GET /api/products` | 3 132 | |
| `GET /api/dashboard/stats` | 2 411 / 2 389 | warm |
| `GET /api/reports/financial` | 2 277 | |
| `GET /api/reconciliation` | 2 135 | |
| `GET /api/integrations/order-confirmation` | 2 131 | |
| `GET /api/customers` | 2 033 | |
| `GET /api/expenses` | 1 962 | |
| `GET /api/integrations/easyorders/webhook-config` | 1 892 | |
| `GET /api/orders/stats` | 1 877 | |
| `GET /api/products` | 1 823 | |
| `POST /api/integrations/easyorders/test` | 1 800 | outbound call to EasyOrders |
| `GET /api/dashboard/top-products` | 1 785 | |

## 3. Checks

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| PERF-01 | the dashboard answers in a reasonable time | < 3 s warm | 2.4 s warm / 6.0 s cold | PARTIAL |
| PERF-02 | the list endpoints answer quickly | < 1.5 s | 1.1–1.4 s | PASS |
| PERF-03 | the bulk reads page instead of loading everything | yes | `fetchAllRows` / `fetchAllByIds` page with a 1 000-row cap | PASS |
| PERF-04 | the `in()` filter is chunked | yes | the dashboard chunks the order-id filter | PASS |
| PERF-05 | the counts use `count: 'exact', head: true` | yes | nine count queries in the dashboard run in parallel | PASS |
| PERF-06 | the export streams instead of buffering the whole table | acceptable | the workbook is built in memory (540 KB for 503 orders) — acceptable at this size, unbounded at 50 000 orders | PARTIAL |
| PERF-07 | no N+1 query pattern | none | the routes use embedded selects (`orders(*, customer:customers(*), items:order_items(*))`) | PASS |
| PERF-08 | the payload size stays bounded | yes | the list returns a page (default 20, max 200) | PASS |
| PERF-09 | the webhook receiver is fast | < 1 s | it enqueues and returns; the import happens in the worker | PASS |
| PERF-10 | the cron worker stays inside the platform budget | yes | the backfill scanner runs for tens of minutes by design and is rate-limited separately (180/min) | PASS |

## 4. Why the dashboard is the slowest screen

`GET /api/dashboard/stats` runs, in parallel:

* nine `count: exact` queries (total, today, five status buckets, customers);
* a full scan of the orders in the period to sum the sales;
* a full scan of the order ids in the period to feed the COGS lookup;
* a full scan of the expenses in the period.

With 2 023 orders the scans are small, but each one is a separate PostgREST round trip and
the dashboard is the first request of every session — exactly the moment when the function
is cold. The 6.0 s outlier is the cold case.

## 5. Recommendations (not implemented)

| Priority | Change | Expected effect |
|---|---|---|
| 1 | a 30–60 s cache for the dashboard stats, keyed by the filter set | removes the cold-start spike from the first paint |
| 2 | replace the three scans with a single aggregate query (`sum`, `count` grouped by status) | one round trip instead of three scans |
| 3 | move the COGS lookup into an aggregate join instead of fetching the order ids first | removes the `in()` chunking round trips |
| 4 | `Cache-Control: s-maxage` on the read-only report routes | lets the Vercel edge absorb repeated refreshes |
| 5 | add `Prefer: count=exact` only where the total is displayed (already the case) | avoids counting when the client ignores `total` |

None of these change behaviour, so they can be scheduled separately from the security
repair.

## 6. Measurement caveats

* The numbers come from one network path (Cairo → Vercel `fra1`) and one moment in time;
  they are not a benchmark.
* The probe measures request → response, including the network round trip; the server
  time alone is lower.
* The `X-RateLimit-*` headers show the limiter was active during the measurements; the
  429 responses in the probe run are the limiter working, not a performance defect.
* No load test was executed (no multi-user scenario), so the behaviour under concurrency
  is **not measured**.
