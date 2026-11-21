# Security — Rate Limiting, Resource Use and Availability

Scope: `src/middleware.ts` (rate limiter), the request cost of the heaviest endpoints, and
the operational limits of the deployment (Vercel Hobby, daily cron only).

---

## 1. The limiter as implemented

| Path class | Limit | Window | Key |
|---|---|---|---|
| `/api/auth/*`, `/api/login`, `/api/register`, `/api/password` | 10 | 60 s | ip + path |
| anything containing `webhook` | 1 000 | 60 s | ip + path |
| `/api/integrations/easyorders/{process-queue,backfill,catch-up}` | 180 | 60 s | ip + path |
| `POST`/`PUT`/`PATCH`/`DELETE` | 30 | 60 s | ip + path |
| everything else | 100 | 60 s | ip + path |

The client IP is taken from `x-forwarded-for` (first entry) or `x-real-ip`.

## 2. Measurement — the rejected hypothesis (F-019)

The claim under test was "the limiter counts a request twice, so the effective limit is
50/min instead of 100/min".

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| RL-01 | 120 sequential GETs to one path | first 429 at request #101 | first 429 at **#101** | PASS — **no double counting** |
| RL-02 | the `X-RateLimit-*` headers | limit, remaining, reset | all three are present and consistent with the count | PASS |
| RL-03 | `Retry-After` on a 429 | present | present | PASS |

The hypothesis is **rejected by measurement**. The genuine limitations are different and
are recorded below.

## 3. Real limitations

### F-010 — the bucket store grew without bound → **fixed**

`rateLimitStore` was a `Map` that was never pruned: every distinct `(ip, path)` pair added
an entry that stayed for the lifetime of the instance. Two consequences:

* a long-lived instance leaks memory;
* an attacker who varies the path (or sends a different `x-forwarded-for` value per
  request) can grow the map at will, because the key is attacker-controlled.

The repair caps the map at **10 000 buckets** and sweeps expired buckets on every check;
if that is not enough, the buckets closest to expiry are dropped.

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| RL-10 | the store is bounded | ≤ 10 000 entries | hard cap + sweep implemented | PASS (after fix) |
| RL-11 | expired buckets are removed | yes | swept on every `checkRateLimit` call | PASS (after fix) |
| RL-12 | the cap does not weaken the limit for active keys | the active bucket survives the sweep | the sweep only removes expired entries first, and only drops the soonest-to-expire buckets when the cap is still exceeded | PASS |

### The limiter is per instance, not global

The store is in-process memory, so with more than one Vercel instance the effective limit
is `limit × instances`. On the Hobby plan the traffic pattern makes this mostly academic,
but it is a real property of the design and not a defect in the implementation.

### The limiter is per path

`/api/orders`, `/api/customers` and `/api/products` each get their own bucket, so a
client can multiply its own budget by spreading requests over paths. A global per-IP
budget would be stricter.

### The client IP is attacker-controlled

`x-forwarded-for` is taken at face value. On Vercel the platform overwrites the header for
incoming requests, so the value is trustworthy **on this platform**; behind another proxy
or in a self-hosted deployment the header must be re-derived by the platform, not by the
application.

## 4. Resource cost of the heaviest endpoints

89 admin probes measured on the production build:

| Percentile | Latency |
|---|---|
| p50 | 957 ms |
| p90 | 1 962 ms |
| p95 | 2 277 ms |
| max | 6 036 ms |

Slowest endpoints (production, admin identity):

| Endpoint | ms |
|---|---|
| `GET /api/dashboard/stats` | 6 036 |
| `GET /api/products` | 3 132 |
| `GET /api/dashboard/stats` | 2 411 / 2 389 |
| `GET /api/reports/financial` | 2 277 |
| `GET /api/reconciliation` | 2 135 |
| `GET /api/integrations/order-confirmation` | 2 131 |
| `GET /api/customers` | 2 033 |

`/api/dashboard/stats` is the most expensive route because it runs nine count queries plus
three full scans (sales rows, order ids for the COGS lookup, expenses). The 6 s outlier is
the cold-start case (first request after the deployment warmed up).

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| RES-01 | the dashboard does not load the whole table into memory | it pages | `fetchAllRows` pages the three scans | PASS |
| RES-02 | the `in()` lookup is chunked | yes | `fetchAllByIds` chunks the order-id filter | PASS |
| RES-03 | a cold request stays within the platform budget | < 10 s | 6.0 s worst observed | PASS (tight) |
| RES-04 | concurrent identical requests are not deduplicated | no cache | every request re-runs the scans | PARTIAL — see §6 |

## 5. Deployment constraints

| Item | Value | Consequence |
|---|---|---|
| Vercel plan | Hobby | cron may run **once per day**; log retention ≈ 30 minutes |
| Cron schedule | daily | the order-confirmation job cannot run more often |
| Functions | serverless, per-instance state | the rate-limit store is per instance; a cold start resets it |
| Database | Supabase, PostgREST with a 1 000-row page cap | every bulk read must page (the code does) |

## 6. Residual risks

1. **The dashboard is the slowest screen and has no cache.** A cold `GET /api/dashboard/stats`
   took 6.0 s. A short-lived cache (30–60 s, keyed by the filter set) would remove the
   p95 spike without changing any semantics — recommended, not implemented.
2. **The limiter is per instance and per path.** A global budget needs a shared store
   (Upstash Redis or a Supabase-backed table); that is a deployment decision.
3. The webhook class allows 1 000 requests/minute per IP. The webhook has its own secret
   check, which is the real gate, but the bucket could be tightened to reduce log noise.
