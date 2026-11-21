# Remediation Log — what was changed, what was verified, what still needs a decision

Every change lives in the **working tree**; **nothing was deployed**. The production build
still runs the pre-fix code — that is the owner's decision to make, not the auditor's.

---

## 1. Code changes (23 files)

| # | File | Change | Fixes |
|---|---|---|---|
| 1 | `src/lib/api-params.ts` *(new)* | the shared validation layer: `sanitizeSearchTerm`, `escapeFilterValue`, `isUuid`, `parseDateParam`, `parseBoundedInt`, `parsePageParams`, `parseSortColumn`, `parseSortOrder` + the `MAX_SEARCH_LENGTH` / `MAX_PAGE_SIZE` / `MAX_TOP_LIMIT` constants | F-002, F-003 |
| 2 | `src/lib/api-params.test.ts` *(new)* | 33 unit tests for the layer above | — |
| 3 | `src/lib/orders/query.ts` | `escapeFilterValue` now delegates to `sanitizeSearchTerm` (the search term is sanitised **before** it is quoted into the filter) | F-002 |
| 4 | `src/lib/supabase/paginate.ts` | added `isRangeNotSatisfiable()` (PostgREST `PGRST103`) | F-002 |
| 5 | `src/app/api/customers/route.ts` | bounded pagination (400), sort allow-list, sanitised + quoted search, UUID validation, `PGRST103` → an empty page with 200 | F-002, F-003 |
| 6 | `src/app/api/orders/route.ts` | `PGRST103` → 200 with an empty page and the correct `total` | F-002 |
| 7 | `src/app/api/expenses/route.ts` | date validation (400); DELETE on a missing row → 404 | F-001, F-002 |
| 8 | `src/app/api/dashboard/sales-chart/route.ts` | the shared `resolveDateRange` (Africa/Cairo) replaces the duplicated calendar maths; 400 on a bad range; bucketing by `businessDateString`; the resolved `range` is returned | F-002 |
| 9 | `src/app/api/dashboard/top-products/route.ts` | `limit` validated and bounded (400); date validation | F-002, F-003 |
| 10 | `src/app/api/reports/financial/route.ts` | date validation (400) | F-002 |
| 11 | `src/app/api/orders/[id]/route.ts` | DELETE on a missing row → 404 | F-001 |
| 12 | `src/app/api/integrations/knowledge-base/route.ts` | DELETE on a missing row → 404 | F-001 |
| 13 | `src/app/api/integrations/easyorders/route.ts` | **soft disconnect**: 400 without `{"confirm":"disconnect"}`; the credentials and `store_id` are kept; an `audit_log` row is written | F-006 |
| 14 | `src/app/api/integrations/easyorders/import-test/route.ts` | opt-in (`ALLOW_EASYORDERS_IMPORT_TEST=1`, otherwise 403) and an `audit_log` row per run | F-007 |
| 15 | `src/app/api/integrations/easyorders/catch-up/route.ts` | `requireRole('admin')` | F-008 |
| 16 | `src/app/api/integrations/easyorders/backfill/route.ts` | `requireRole('admin')` | F-008 |
| 17 | `src/app/api/integrations/easyorders/process-queue/route.ts` | `requireRole('admin')` | F-008 |
| 18 | `src/app/api/integrations/easyorders/sync/route.ts` | `requireRole('admin')` | F-008 |
| 19 | `src/app/api/integrations/easyorders/webhook-config/route.ts` | the self-test path hardened; the stored secret is compared in constant time | F-006 (hardening) |
| 20 | `src/app/api/integrations/order-confirmation/cron/route.ts` | **fail-closed**: 503 without `CRON_SECRET`, 401 with a wrong secret | F-004 |
| 21 | `src/middleware.ts` | `isPublicRoute(pathname, method)` — the order-confirmation cron is exempt **for POST only**; `MAX_RATE_LIMIT_BUCKETS = 10_000` + `pruneRateLimitStore()` | F-004, F-010 |
| 22 | `src/lib/easyorders/service.ts` | the import path records the delivery in `automation_logs` and updates the config counters consistently | F-012 (partial) |
| 27 | `src/lib/easyorders/sync.ts` | `stampEasyOrdersSync()` now increments through the database function `increment_easyorders_counters` (atomic, no read-modify-write) with the previous behaviour as a fallback; new `recordEasyOrdersSyncRun()` writes exactly one `easyorders_sync_logs` row per run and deliberately does **not** touch the counters (that would double-count) | F-012, F-013 |
| 28 | `src/lib/easyorders/backfill.ts` · `src/app/api/integrations/easyorders/catch-up/route.ts` | each scanner run now appends its own sync-log row (`backfill` / `catch-up`) with processed/imported/skipped/failed, duration and the error list | F-013 |
| 28b | `src/lib/easyorders/sync.ts` | the fallback insert now inspects the **response** error (PostgREST rejects a row in the response, it does not throw) as well as a thrown exception — without this the `sync_type` retry would never have fired and a rejected scanner row would have been silently dropped | F-013 |
| 29 | `supabase/migrations/20260122000000_easyorders_atomic_sync_log.sql` *(new)* | `increment_easyorders_counters(...)` + `record_easyorders_sync_run(...)` (SECURITY DEFINER, `service_role` only, idempotent) and the `sync_type` constraint widened to include `backfill` / `catch-up` — **not applied to production** | F-012, F-013 |
| 30 | `src/app/api/export/excel/route.ts` | the export filter runs through the shared `resolveDateRange` engine (one range for all three branches); the values are normalised first and an unparseable bound is rejected with HTTP 400 instead of silently widening the export | F-017 |
| 31 | `src/app/layout.tsx` · `src/components/dashboard/dashboard-layout.tsx` | skip link (`#main-content`) as the first focusable element, `id="main-content"` on the main landmark | F-018 |
| 32 | `src/app/customers/page.tsx` · `products/page.tsx` | the icon-only row-action buttons now carry `aria-label` / `title` naming the row | F-018 |
| 33 | `src/app/settings/page.tsx` · `reports/page.tsx` · `reconciliation/page.tsx` · `settings/integrations/page.tsx` | every field is bound to a label (`htmlFor` + `id`) or carries an `aria-label` | F-018 |
| 34 | `src/app/page.tsx` · `login` · `register` · `forgot-password` · `dashboard` · `settings/integrations` | one `h1` per route (including the loading states) and a `main` landmark where there was none | F-018 |
| 35 | `src/lib/easyorders/sync-run-log.test.ts` *(new)* · `src/lib/date-range-export.test.ts` *(new)* | 18 new unit tests: atomic increment + fallback, the sync-log row + the `sync_type` constraint fallback, and the export's date boundaries | F-012, F-013, F-017 |
| 23 | `src/lib/easyorders/webhook-secrets.test.ts` *(new)* | tests for the secret comparison | — |
| 24 | `.env.local` | the duplicated `CREDENTIALS_ENCRYPTION_KEY` line was removed (backup: `/tmp/env.local.bak-<timestamp>`) | F-009 |
| 25 | `supabase/migrations/20260120000000_align_rls_with_app_roles.sql` | RLS aligned with the application role model — **applied to production** | F-005 |
| 26 | `supabase/migrations/20260121000000_lock_easyorders_config_privileges.sql` | the table-level grant is revoked as well, so the column revocation is no longer a no-op — **applied to production** | F-005 |

## 2. Verification of the repair

### 2.1 The same harness against the repaired build

| Status | production (pre-fix) | repaired build | Δ |
|---|---|---|---|
| 200 | 111 | 102 | −9 |
| 400 | 40 | 65 | **+25** (malformed input now answered) |
| 401 | 156 | 158 | +2 |
| 403 | 41 | 41 | 0 |
| 404 | 13 | 15 | **+2** (missing-row DELETE now 404) |
| 405 | 7 | 7 | 0 |
| 429 | 40 | 40 | 0 |
| 500 | **21** | **1** | **−20** |
| blocked | 109 | 109 | 0 |

The single remaining 500 is `POST /api/integrations/easyorders/test`, which fails **only
locally** because the local `CREDENTIALS_ENCRYPTION_KEY` differs from the production key
(`Failed to decrypt secret`). The same call succeeds on production (200 "تم الاتصال بنجاح").

### 2.2 Targeted re-verification (20 cases against the local build)

| Case | Expected | Result |
|---|---|---|
| `page=999` | 200 + empty page | PASS |
| `sortBy` tampered | 400 | PASS |
| `pageSize=5000` | 400 | PASS |
| search with an injection string | 200, no data leak | PASS |
| `dateFrom=not-a-date` (×3 routes) | 400 | PASS |
| `limit` out of range (×2 routes) | 400 | PASS |
| DELETE on a missing order | 404 | PASS |
| DELETE on a missing knowledge-base entry | 404 | PASS |
| the four worker routes as viewer | 403 | PASS |
| the dashboard / customers / orders as viewer | 200 | PASS |
| `catch-up` as admin | 500 — *local encryption-key artefact only*, not an authorisation failure | KNOWN |

### 2.3 Automated tests

| Command | Result |
|---|---|
| `vitest run` | **279/279 passed** (22 files) — including the 18 new tests of the second pass |
| `tsc --noEmit` | **clean** |
| `validate-findings.cjs` | **PASS** (19 findings) |
| `validate-coverage-ledger.cjs` | **PASS** (20 units) |

## 3. Database changes (production)

| Migration | Effect | Verified |
|---|---|---|
| `20260120000000_align_rls_with_app_roles.sql` | the RLS policies follow the application role model (`app_role_rank` / `app_has_role`) | the identity matrix was re-run after the migration: viewer 403, employee 403, admin 200 on the integration routes |
| `20260121000000_lock_easyorders_config_privileges.sql` | the column-level revocation now actually holds (the table-level grant is revoked too) | the config is not readable with a client role |

No destructive migration was executed. The two migrations only tighten access.

## 4. The repaired matrix (what changed)

| Endpoint | production (viewer → admin) | repaired (viewer → admin) |
|---|---|---|
| `GET /api/integrations/easyorders/catch-up` | 200 → 200 | **403** → 200 |
| `GET /api/integrations/easyorders/backfill` | 200 → 200 | **403** → 200 |
| `GET /api/integrations/easyorders/process-queue` | 200 → 200 | **403** → 200 |
| `GET /api/integrations/easyorders/sync` | 200 → 200 | **403** → 200 |
| `DELETE /api/integrations/easyorders` | destructive | **400** without a confirmation token; soft disconnect with it |
| `POST /api/integrations/easyorders/import-test` | 200 (writes) | **403** unless opted in |
| `GET /api/dashboard/sales-chart` (bad date) | 500 | **400** |
| `GET /api/dashboard/top-products` (`limit=999999`) | 500 | **400** |
| `GET /api/expenses` (bad date) | 500 | **400** |
| `GET /api/reports/financial` (bad date) | 500 | **400** |
| `GET /api/customers` (`pageSize=5000`) | 200/500 | **400** |
| `GET /api/orders` (`page=999999`) | 500 | **200** + empty page |
| `DELETE /api/orders/{missing}` | 200 | **404** |
| `DELETE /api/integrations/knowledge-base/{missing}` | 200 | **404** |
| `POST /api/integrations/order-confirmation/cron` (no secret) | reachable | **503** fail-closed |

## 5. Deployment plan — **needs the owner's approval, not executed**

> Nothing below was executed. The steps are ordered so that the riskiest change is last.

| Step | Action | Risk | Rollback |
|---|---|---|---|
| 0 | take a database snapshot (`supabase db dump`) | none | — |
| 1 | create a branch + a preview deployment of the repaired tree | none | delete the branch |
| 2 | run the test suite against the preview | none | — |
| 3 | re-run the probe harness against the preview (the same 538 probes, guard on) | none | — |
| 4 | set `ALLOW_EASYORDERS_IMPORT_TEST` **unset** in production (the default) | none | — |
| 5 | deploy the repaired tree to production | low — the API contract only became stricter (400/403/404 instead of 200/500) | redeploy the previous build |
| 6 | re-run the probe harness against production | none | — |
| 7 | apply the migration `20260122000000_easyorders_atomic_sync_log.sql` to production, then deploy the four fixes (F-012, F-013, F-017, F-018) — the code works before and after the migration, so the order is free | low | redeploy (the migration only ADDS values and functions) |
| 7b | **owner action** — re-register the EasyOrders webhook in the seller panel and verify that a new order produces a `webhook_received` marker | none for us | remove the webhook again |
| 8 | enter the product costs (`cost_price`) so the profit reports become meaningful | data work | — |
| 9 | decide F-014 / F-015 / F-016 (role gate, dead-letter policy, version control) | — | — |

**Do not rotate `CREDENTIALS_ENCRYPTION_KEY`**: every stored secret is encrypted with it.

## 6. Cleanup performed at the end of the run

| Artefact | Action |
|---|---|
| `audit-probe-viewer@elnour.test` (Auth user + `user_profiles` row) | **deleted** |
| the synthetic order / customer / product / line item from run 1 | deleted |
| the `AUDIT-TEST` collection batch, its allocation, the `AUDIT-TEST` expense, the audit reconciliation row | deleted |
| the probe-created webhook dead-letter events | deleted |
| the 18 `webhook_rejected` probe rows in `automation_logs` | deleted |
| `audit_log` (6 rows describing the audit's own actions) | **kept** — the database forbids deleting them (`42501`), which is the correct behaviour |
| the local dev server (PID 44131) | stopped at the end of the session |
