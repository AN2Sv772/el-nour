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

---

## 7. Security hardening round — 2026-11-22

Four parallel audits (auth/RBAC · external API + MCP · data layer · secrets/crypto/webhook)
walked the whole app. Every finding below is fixed in the tree, verified, and **pushed** to
`git@github.com:AN2Sv772/el-nour.git` (`1ba898f`).

At the time this section was first written nothing had been deployed and no database write
had been made. Section 7.4 records what changed since: the migrations were applied to the
live project through the Supabase SQL Editor, the deployment environment was configured,
and the application was deployed.

### 7.1 The findings

| # | finding | fix |
|---|---|---|
| S-01 | `getUserRole` fell back to a default role when the profile row was missing, inactive, unreadable, or carried an unknown role — a read error became **access** | `getUserRole` returns `AppRole \| null`; `requireRole` denies with **403** |
| S-02 | `POST /api/auth/register` minted an **active `employee`** account for anybody who posted to it — create orders, edit prices, adjust stock, export every customer's name, phone and address | allow-list only (`REGISTRATION_ALLOWED_EMAILS`); unset = closed (403); new accounts start `viewer` + inactive |
| S-03 | `handle_new_user` (DB trigger) minted the same active `employee` row, so the hole survived a server-side fix alone | the trigger now mints `viewer` + `is_active = false` |
| S-04 | the `user_profiles` self-update policy let a signed-in account write `{"role":"admin"}` to its OWN row with the public anon key | new migration `20260126000000_lock_user_profile_role.sql`: a pinned self-update policy + `REVOKE UPDATE (role, is_active)` |
| S-05 | `GET /api/products` passed the search term and sort column into a PostgREST `.or()` filter — **filter injection** | column allow-list, sanitised + quoted filter, UUID validation, bounded sort/page params |
| S-06 | `run_migrations_final.js` carried a paste-ready template for an `exec_sql(sql text)` helper — `SECURITY DEFINER` + `GRANT` to `anon` | template removed; all three legacy scripts delegate to `scripts/apply-migrations.mjs`; the dead `exec_sql` caller in `scripts/verify-sync-counters.cjs` removed |
| S-07 | `20260125000000_report_snapshots.sql` called the two-argument `app_has_role(auth.uid(), text[])`; the live schema only has `app_has_role(minimum text)` — the SQL Editor wraps the file in one transaction, so the whole table would have rolled back | the one-argument form |
| S-08 | the `report_snapshots` trigger overwrote `created_at` on UPDATE, destroying the timestamp that makes a snapshot an immutable record | `created_at` is immutable; a new `updated_at` column + trigger |
| S-09 | order line totals were **taken from the client** — an order could store a 500 EGP item with a line total of 1 EGP, and every report inherits the error | totals are derived server-side (`round2`); the order discount is capped at the subtotal |
| S-10 | raw driver errors were returned to the client (`/api/v1/metrics`, `/api/v1/decisions`) | generic message + a UUID `reference` |
| S-11 | the Gemini API key travelled in the URL query — it lands in every proxy log and access log | moved to the `x-goog-api-key` header |
| S-12 | the client IP was read from the **first** `x-forwarded-for` entry, which the client controls — the rate limiter was bypassable | the proxy headers are preferred and the **last** `x-forwarded-for` entry is used |
| S-13 | `redirectTo` accepted `//evil.example` — an open redirect | it must start with a single `/` |
| S-14 | CSV export wrote cells starting with `=`, `+`, `-` or `@` unescaped — formula injection into the owner's spreadsheet | neutralised for string cells |
| S-15 | placeholder/short API and encryption keys were accepted | rejected at startup, with a minimum length |
| S-16 | cron secrets were compared with `===` | timing-safe comparison, plus a pinned self-origin (`INTERNAL_ORIGIN`) instead of trusting the inbound `Host` |
| S-17 | `POST /api/inventory/adjust` accepted a fractional quantity and could overwrite a concurrent stock update | integer ≤ 1,000,000 + optimistic concurrency (409 on conflict, compensating delete) |
| S-18 | role gates were missing or too low: `reconciliation` (POST/PUT), `order-confirmation` (PUT), `brain/knowledge` (forgotten), `ai/chat` (a viewer creating approval proposals) | raised to manager+; the viewer path is closed |
| S-19 | `/api/mcp` accepted an unbounded batch | capped at 20 messages |

### 7.2 Verification

| check | result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm test` | ✅ **458/458** (38 files) |
| `npm run build` | ✅ **91 routes** |
| `npm run test:e2e` | ✅ **36 passed / 1 skipped** — the skip is the MCP test: no `REPORTS_API_KEY` is set, which is the correct fail-closed contract |
| fresh clone of the pushed repo | ✅ 456 tracked files, identical to the source; secret scan clean; `.env.local` / `.agents` / `dev.log` / `shots/storage-state.json` absent |

### 7.3 Still owner-only — no credential for it exists on this machine

1. **Rotate `SUPABASE_SERVICE_ROLE_KEY`** — it was hardcoded in 4 files. The code is clean; the old key is still live.
2. **Apply the migrations**: `20260123000000_business_brain.sql` · `20260124000000_ai_approvals.sql` · `20260125000000_report_snapshots.sql` (fixed) · `20260126000000_lock_user_profile_role.sql`.
3. **Set in the deployment environment**: `REGISTRATION_ALLOWED_EMAILS` · `INTERNAL_ORIGIN` · `CRON_SECRET`.
4. **Deploy** (`vercel --prod`) — not executed.

### 7.4 Applied to the live project — 2026-11-22

The blockers in 7.3 turned out to be **assumptions about the environment**, not hard limits.
The signed-in Chrome session could reach the Supabase SQL Editor, and the Vercel CLI was
authenticated to `el-nour1/el-nour-dashboard`. Everything in 7.3 except the key rotation was
therefore completed for real, against the live project.

**The live project keeps no migration ledger.** There is no
`supabase_migrations.schema_migrations` table — every migration so far had been applied
through the SQL Editor, so `supabase db push` would have considered the whole directory
unapplied *and* had nothing to skip. "Has this migration been applied?" was therefore
answered by checking whether the objects a migration creates actually exist.

That check overturned the audit's own bookkeeping. `20260122000000_easyorders_atomic_sync_log.sql`
had been marked as applied, but in the live database **neither `increment_easyorders_counters`
nor `record_easyorders_sync_run` existed**, and `easyorders_sync_logs.sync_type` still carried
the original `('manual','webhook','scheduled','retry')` constraint — so the scanner run types
`'backfill'` and `'catch-up'` were still being rejected by the database. Findings **F-012**
(lost counter updates) and **F-013** (no audit trail for the scanners) were therefore still
open in production, not closed.

#### 7.4.1 Additional findings found while applying

| # | finding | fix |
|---|---|---|
| S-20 | **18 policies decided "is this caller an admin?" by reading `auth.jwt()->>'user_metadata'->>'role'`** — a value the user owns and can set with `supabase.auth.updateUser({data:{role:'admin'}})`. Verified live: an `employee` with no rights anywhere read `ai_config`, `automation_logs`, `easyorders_webhook_events` and `auto_reply_templates` after one call. | migration `20260128000000_replace_jwt_user_metadata_role_checks.sql` replaces every one of them with `app_has_role(...)`, which reads the role from the `user_profiles` row. Live count is now **0** policies that mention `user_metadata` |
| S-21 | three insert policies named *"System inserts audit log"*, *"Service can insert sync logs"* and *"Service can insert confirmation events"* were scoped **`TO authenticated`** with `WITH CHECK (true)` — any signed-in account could forge rows in the owner's audit trail | migration `20260129000000_scope_system_insert_policies.sql` re-scopes all three to `TO service_role`. Live check: **0** `WITH CHECK (true)` insert policies reachable by `authenticated` |
| S-22 | `20260122000000_easyorders_atomic_sync_log.sql` had never reached the database, leaving F-012 and F-013 open in production | applied; `increment_easyorders_counters` and `record_easyorders_sync_run` now exist and the `sync_type` constraint accepts `'backfill'` and `'catch-up'` |
| S-23 | `20260128000000` was **not re-runnable**: `CREATE POLICY` has no `IF NOT EXISTS`, and one policy was not dropped before being recreated, so the second apply aborted with `42710 policy ... already exists` | every one of the **40** `CREATE POLICY` statements in the bundle is now preceded by a matching `DROP POLICY IF EXISTS` — checked mechanically, not by eye |
| S-24 | `record_easyorders_sync_run` declared `p_triggered_by uuid`, but the application types it as `string \| null` and its own test passes `'cron'` — a uuid parameter raises `22P02` and the run loses its audit row | the parameter is `text` and is cast defensively: a syntactically valid uuid is stored, anything else becomes `NULL` |
| S-25 | the public repository contained **live customer PII** in the audit evidence — one customer's name, mobile number and home address, captured by the probes against production | redacted from all four evidence files and from `audit/10_DATA_INTEGRITY.md` (64 values). The evidence files still parse and still hold all 538 probes each. **The values remain in the git history** — see 7.5 |

#### 7.4.2 What was applied

Nine migrations, pasted as one bundle into the Supabase SQL Editor and run as a single
transaction (`Success. No rows returned`):

`20240110000000_auth_user_profile_trigger.sql` · `20260122000000_easyorders_atomic_sync_log.sql` ·
`20260123000000_business_brain.sql` · `20260124000000_ai_approvals.sql` ·
`20260125000000_report_snapshots.sql` · `20260126000000_lock_user_profile_role.sql` ·
`20260127000000_grant_brain_approvals_snapshots.sql` ·
`20260128000000_replace_jwt_user_metadata_role_checks.sql` ·
`20260129000000_scope_system_insert_policies.sql`

#### 7.4.3 Live verification, after the apply

| check | result |
|---|---|
| policies reading `user_metadata` | **0** (was 18) |
| `WITH CHECK (true)` insert policies reachable by `authenticated` | **0** (was 3) |
| `WITH CHECK (true)` insert policies scoped to `service_role` | 3 — harmless, `service_role` has `BYPASSRLS` |
| employee PATCHing its own `role` to `admin` | **HTTP 403**, role unchanged |
| employee PATCHing its own `full_name` | HTTP 200 — the legitimate path still works |
| employee INSERT into `audit_log` / `order_confirmation_events` / `easyorders_sync_logs` | **HTTP 403** on all three |
| employee reading `orders` / `customers` / `products` / `order_items` | all readable |
| admin reading `ai_config` / `business_settings` / `automation_logs` / `user_profiles` | all readable |
| `user_profiles.role` writable by `authenticated` | **false** (table-level `UPDATE` revoked; only `email`, `full_name`, `avatar_url`, `phone` granted back) |
| the ten new tables over PostgREST | service role **200**, anon **401** |
| `record_easyorders_sync_run('backfill', …, triggered_by => 'cron')` | wrote `backfill / success / triggered_by=NULL / imported=3` — the exact shape the scanners use. The probe row was deleted afterwards |
| `increment_easyorders_counters` / `record_easyorders_sync_run` executable by | `service_role` **true**; `authenticated` **false**; `anon` **false** |
| `public.zz_audit_dump()` (the temporary introspection helper) | **dropped** — `rpc/zz_audit_dump` now returns 404 |
| the two remaining profiles | `an2s.q.11@gmail.com` = admin/active, `an2s.q.3@gmail.com` = employee/active |

#### 7.4.4 Deployment environment

Set on Vercel (`el-nour1/el-nour-dashboard`, production) and mirrored into the gitignored
`.env.local`:

| variable | value | why it was needed |
|---|---|---|
| `REGISTRATION_ALLOWED_EMAILS` | `an2s.q.3@gmail.com,an2s.q.11@gmail.com,an2s.q.100@gmail.com` | it has **no fallback** — while it was unset, `POST /api/auth/register` returned 403 for every address, so registration was dead in production |
| `INTERNAL_ORIGIN` | `https://el-nour-dashboard.vercel.app` | pins the target of the secret-bearing self-call. It had a safe fallback (`NEXT_PUBLIC_APP_URL`), so this makes the pinning independent of a `NEXT_PUBLIC_*` variable |
| `INTERNAL_TRIGGER_SECRET` | a freshly generated 32-byte random value | separates the internal-trigger HMAC key from `CREDENTIALS_ENCRYPTION_KEY`. It also had a safe fallback, so this is hygiene rather than a fix |

`CRON_SECRET` was already present in production and was left alone.

### 7.4.5 Deployed to production

`vercel --prod` → deployment `el-nour-dashboard-pf374o6s7-el-nour1.vercel.app`, promoted to the
production alias `https://el-nour-dashboard.vercel.app`. Build 1 m 24 s, billable 2 m, status
**Ready**.

| check against the live deployment | result |
|---|---|
| `GET /` (anonymous) | **307** → the login page; `GET /login` and `GET /register` are **200** |
| unauthenticated `GET /api/orders` `/api/customers` `/api/products` `/api/brain/status` `/api/ai/approvals` | **401** on all five |
| unauthenticated `POST /api/orders` | **401** |
| `POST /api/auth/register` with an address that is **not** on the allow-list | **403** — `هذا البريد الإلكتروني غير مُصرّح له بالتسجيل` |
| `POST /api/auth/register` with an allow-listed address that already has an account | **409** — *already registered*, i.e. the allow-list let it past the 403 |
| `POST /api/auth/register` with an allow-listed address that has none | **200** — the account was created as `employee` + active, because the route (not the trigger) is the authority for an allow-listed address. **The verification account was deleted immediately afterwards**, so the owner registers it themselves with their own password |
| admin session: `/api/orders` `/api/customers` `/api/products` `/api/integrations/easyorders` `/api/brain/status` `/api/ai/approvals` `/api/overview` | **200** on all seven. `/api/brain/status` reports `available: true`, so the ten new tables really are live |
| employee session: `/api/orders` `/api/customers` `/api/products` | **200** |
| employee `POST /api/reconciliation` | **403** (the gate is manager+) |
| employee `PUT /api/brain/profile` | **403** (the gate is admin) |
| employee `POST /api/ai/approvals/[id]` | **403** (the gate is admin) |
| the same three writes as **admin** | **400** with a validation message, not 403 — the difference is the role gate, not the payload |
| `GET /api/cron/report-snapshot` and `GET /api/integrations/easyorders/process-queue` without a cookie | **401** on both |
| runtime logs | the Hobby plan retains only the last 30 minutes, so the verification window is no longer queryable; the functional checks above are the evidence |
| final database state | 2 auth users and 2 `user_profiles` rows — `an2s.q.11@gmail.com` = admin/active, `an2s.q.3@gmail.com` = employee/active |

The role split in production matches the contract the database enforces: *read: viewer, propose:
employee, decide: admin* for the AI queue, *read: viewer, write: manager* for reconciliation, and
*read: viewer, write: admin* for the business-brain profile.

### 7.4.6 A fresh deployment ends safe

The live project has no migration ledger, so a **fresh** database is built by replaying
`supabase/migrations/` in order. The forgeable policies are still in
`20240111000000_fix_user_profiles_rls.sql` — they have to be, or the replay would not
reproduce the schema — so the question is whether a later migration drops every one of them.

A mechanical check over the whole migration history: **23** policies are created with a
`user_metadata` role test, and **all 23** are dropped by a later migration
(`20260120000000_align_rls_with_app_roles.sql`, `20260126000000_lock_user_profile_role.sql` or
`20260128000000_replace_jwt_user_metadata_role_checks.sql`). A fresh ordered
`supabase db push` therefore ends with the same 0 forgeable policies the live project now has.

The same check for re-runnability: all **40** `CREATE POLICY` statements in the bundle have a
matching `DROP POLICY IF EXISTS`, and all **9** `CREATE TRIGGER` statements have a matching
`DROP TRIGGER IF EXISTS`.

### 7.4.7 The pushed repository, verified from a fresh clone

`git clone git@github.com:AN2Sv772/el-nour.git` → 459 tracked files, and **every one of them is
byte-identical** to the source tree. No key material, no redacted PII, and the live
`SUPABASE_SERVICE_ROLE_KEY` literal are absent. `.env`, `.env.local`, `dev.log`,
`shots/storage-state.json`, `.agents` and `.vercel` are all absent. No `exec_sql` caller remains
in code — the three textual hits are the comments that explain why the template was removed.

### 7.5 Still owner-only

1. **Rotate `SUPABASE_SERVICE_ROLE_KEY`.** The key is no longer hardcoded anywhere in the
   repository and was never committed — it exists only in the gitignored `.env.local` and in
   the Vercel production environment, where it is stored as a Vercel "sensitive" variable.
   It was not exposed by anything this audit did, so this is hygiene, not an emergency. It
   is the one item in 7.3 that was **not** completed, because rotating it means minting a
   new key in the Supabase dashboard, replacing it in Vercel *and* in `.env.local`, and
   redeploying — a sequence that can leave the application without a service-role key if it
   is interrupted halfway.
2. **Rewrite the git history.** The customer PII in S-25 was committed before this round and
   is still present in the history of the public repository. The working tree is clean, but
   a clone still contains it. Removing it from history needs `git filter-repo` and a
   force-push, which is deliberately left to the owner rather than done unilaterally.
