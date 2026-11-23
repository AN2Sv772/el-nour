# Security Closure Report — Final Independent Re-Audit

**Project:** El Nour Dashboard
**Repo:** `git@github.com:AN2Sv772/el-nour.git` (public) · remote head at the time of writing: `5ff3fae`
**DB:** `lyswmlmrlviptprhfiph` (49 public tables, 138 policies, 24 public functions)
**App:** `https://el-nour-dashboard.vercel.app`
**Date:** 2026-11-23

> **READINESS VERDICT: NOT READY TO BE CALLED FULLY SECURE.**
> One **critical** unauthenticated-write path and one **high** credential-read
> path remain open in production. Both are closed by a single, dry-run-verified
> migration that is **prepared but not applied** (it needs owner approval —
> Plan C in `audit/20_REMEDIATION_PLANS.md`). Everything else in the previously
> reported surface was independently re-verified and holds.

---

## 1. What this round did differently

The previous round's findings were **not** assumed to be resolved. Every
finding was re-derived from the live database and the live deployment:

* The live catalog was queried directly through the Supabase SQL Editor
  (`pg_proc`, `pg_policies`, `pg_class`, `pg_depend`, `storage.buckets`).
* Every "reachable by anon" claim was **reproduced over HTTP** with the
  project's publishable key — not inferred from the catalog.
* Every "fixed" claim was re-probed with freshly minted **admin** and
  **employee** sessions against production.
* The git history was re-scanned end to end (133 155 patch lines) with an
  exact-match check against the live secrets.
* The full regression suite was re-run: **TS 0 · 458/458 unit · build 0 ·
  36 e2e passed + 1 skipped**.

Two probe-design errors of my own were caught and corrected before they
became findings: a registration probe missing `fullName`/`confirmPassword`
returned 400 instead of the real 403, and an RPC probe sent mismatched
parameter names, which PostgREST reports as `PGRST202` (function not found),
not as a permission error. Both were re-run correctly; the corrected results
are the ones reported below.

---

## 2. Findings

### 2.1 CRITICAL — unauthenticated order creation via `create_order_atomic`

| | |
|---|---|
| **Vector** | `POST /rest/v1/rpc/create_order_atomic` with the publishable key |
| **Function** | `public.create_order_atomic(uuid,jsonb,jsonb,jsonb,payment_method,numeric,numeric,numeric,text,character varying)` — `SECURITY DEFINER`, `search_path = public`, **no internal authorization check** |
| **Reproduced** | **Yes.** HTTP 400 with `{"code":"22023","message":"cannot extract elements from an object"}` — the function *executed its own body* and raised inside `jsonb_array_elements`, rather than being refused at a permission check |
| **Impact** | Unauthenticated writes to `orders`, `order_items` and `automation_logs` |
| **Preconditions** | A valid `customer_id` UUID (`orders.customer_id` is `NOT NULL REFERENCES customers(id)`). No public endpoint creates customers, and the `customers` table is not readable by `anon`, so the UUID must come from elsewhere |
| **Application usage** | **0 call sites** in `src/` — dead code that stayed live in the database |
| **Data written during the probe** | **None.** The probe used a deliberately malformed `p_items` (an object instead of an array), which raises *before* the first INSERT. Verified afterwards: `orders` with the sentinel `customer_id` = 0, orders created on the probe date = 0 |

### 2.2 HIGH — unauthenticated read of the encrypted EasyOrders credential

| | |
|---|---|
| **Vector** | `POST /rest/v1/rpc/get_or_create_easyorders_config` with the publishable key |
| **Reproduced** | **Yes.** HTTP 200, one row, `api_key` = `v1:` ciphertext (133 chars) |
| **Impact** | Disclosure of the encrypted integration credential + unauthenticated `SECURITY DEFINER` access that **bypasses the `easyorders_config` table lockdown** (that table's ACL is `postgres, service_role` only). The function can also INSERT the config row when none exists |
| **Severity note** | The value is ciphertext (`v1:` AES-256-GCM), not plaintext, and `CREDENTIALS_ENCRYPTION_KEY` is server-side only → **HIGH, not CRITICAL** |
| **Application usage** | **0 call sites** — the app reads `easyorders_config` directly with `.from(...)` |

### 2.3 MEDIUM — two unauthenticated DELETEs

`cleanup_expired_otp_codes()` and `cleanup_old_easyorders_webhook_events()`
are `SECURITY DEFINER` and returned **HTTP 204 to anon**, i.e. **they
executed**. Both are 0-call-site dead code.

* `otp_codes` is empty (0 rows) — the probe removed nothing that remains.
* `easyorders_webhook_events` still holds its 2 rows, created 2026-11-06
  (17 days old). The predicate is `created_at < now() - 30 days`, so it did
  not match — **nothing was deleted**. Verified by re-reading the rows.

### 2.4 MEDIUM — unauthenticated profile-existence oracle

`current_profile_is_active(uuid)` returned `true` for the known employee UUID
and `null` for a random one. 0 application call sites.

### 2.5 MEDIUM — unused write policy into the webhook queue

`"Employees can create webhook events"` (INSERT, `authenticated`,
`app_has_role('employee')`). The application inserts into
`easyorders_webhook_events` through the **service client** (the webhook
route), so this grant has **no legitimate use**. It let an employee plant
arbitrary payloads that the manager/cron-gated queue later executes through
the real import pipeline (`processWebhookEvent` → customer/order creation, and
`handleStatusUpdate` → mutating an existing order's status).

**Not a privilege escalation:** `PATCH /api/orders/[id]` is already
`employee`-gated, so the same role can already change an order. The marginal
risk is bypassing that route's validation and audit trail. Classified MEDIUM
on that basis, not HIGH.

### 2.6 MEDIUM — stale credential published in the public repository

`.env.example` at HEAD contained a live-looking `EASYORDERS_API_KEY` and
`EASYORDERS_STORE_ID`. The file's own header states *"NEVER commit real
secrets — placeholders only in this file."*

**Severity was reduced to MEDIUM by evidence, not assumption:**

* The published value is **23 bytes**; the live DB credential decrypts to a
  **36-byte** plaintext (133-char ciphertext − 61-char `v1:` envelope). They
  are **different values**.
* EasyOrders answers `Api-Key not valid` (HTTP 400) for the published value —
  byte-identical to the response for a deliberately wrong control key.
* The live key demonstrably authenticates: the audited backfill imported
  **3 live orders** using the DB key.

**So the live EasyOrders key was never in git.** The exposure was a stale,
already-revoked credential. It was removed from HEAD in commit `5ff3fae`
(pushed; remote head verified `5ff3faeb5f95d86b52eb0e0ea28859dbadb72804`).

### 2.7 LOW — residual and defence-in-depth items

| Item | Evidence |
|---|---|
| `authenticated` keeps EXECUTE on `current_profile_is_active(uuid)` after the fix (a live policy needs it) | residual authenticated-only oracle; UUIDs not enumerable, non-admins cannot read other profiles |
| No `import 'server-only'` on the modules that read secrets | **0** `'use client'` module imports the service client; **0** built artefacts contain the key. Fixing it needs a dependency + a vitest alias, or 3 test files throw at import |
| Silent empty mock client when `SUPABASE_SERVICE_ROLE_KEY` is unset | reads fail with an error object rather than throwing — a misconfigured deploy reads as "no data" |
| Owner/team e-mail addresses in the public docs | 3 addresses, already public; targeted-phishing value only |
| 6 phone-shaped values + 24 email-shaped values in the current tree | **0 of 6** and **0 of 24** match any of the **1 935** live customers (paginated read, not the 1 000-row REST cap) — stale/test fixtures, not live customer PII |

---

## 3. Findings from the previous round — independently re-verified as FIXED

| Area | Re-verification | Result |
|---|---|---|
| Forgeable role source | `pg_policies` scan for `user_metadata` | **0** policies read it |
| Unrestricted `WITH CHECK (true)` inserts | reachable-by-`authenticated` inserts | **0**; the 3 remaining are `service_role`-only |
| Employee self-promotion | `app_role_rank()` + column-level REVOKE | employee PATCH → **403**, role unchanged |
| Employee writes to audit/system tables | direct inserts | **403** on all 3 |
| New brain/AI/snapshot tables | service-role 200 / anon 401 | as designed |
| `record_easyorders_sync_run` signature | `p_triggered_by` is `text` with a defensive uuid cast | accepts `'cron'`; audit row no longer lost |
| `sync_type` constraint | accepts `'backfill'` / `'catch-up'` | confirmed |
| Migration re-runnability | every `CREATE POLICY` has a matching `DROP POLICY IF EXISTS` | 40/40; all 9 `CREATE TRIGGER` drop-first |
| Fresh-clone safety | 459 tracked files, byte-identical; no key material; no live PII | confirmed |
| Migration-history safety | 23 `user_metadata` role policies across history, all dropped later | a fresh ordered `supabase db push` ends safe |

### Production behaviour re-verified (2026-11-23, live deployment)

| Probe class | Result |
|---|---|
| Anonymous → 9 API endpoints (reads, writes, cron) | **401** on all 9 |
| Anonymous → registration, off-allow-list | **403** `هذا البريد الإلكتروني غير مُصرّح له بالتسجيل` |
| Allow-listed + already existing → registration | **409** (no account created) |
| Admin → 9 read endpoints | **200** on all |
| Admin → `POST /api/reconciliation`, `PUT /api/brain/profile` | **400** (role passed, validation rejected) |
| Employee → 5 read endpoints | **200** on all |
| Employee → `POST /api/reconciliation`, `PUT /api/brain/profile`, `POST /api/ai/approvals/[id]`, `GET /api/integrations/easyorders/webhook-config` | **403** on all 4 |
| Service-role key used as a session cookie | **401** |
| `set local role authenticated; select … from orders` | succeeds — RLS still evaluates |

The anonymous register probe creates **no** account (the allow-listed address
already exists → 409, and `admin.createUser` fails for an existing e-mail
before the privileged profile upsert can run — so no user can re-register to
re-activate or re-role a profile).

---

## 4. Regression results (re-run, 2026-11-23)

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0** |
| Unit | `npm test` | **458 passed / 458**, 38 files, 27.19 s |
| Production build | `npm run build` | **exit 0**, compiled in 23.2 s, 27 static pages |
| E2E | `npm run test:e2e` | **36 passed, 1 skipped**, 2.9 m, **exit 0** |

---

## 5. What is deployed right now

| Item | State |
|---|---|
| Production deployment | `el-nour-dashboard.vercel.app` — Ready, build 1m24s, billable 2m |
| Applied migrations | 9 (`20240110000000` … `20260129000000`), all confirmed live |
| Pending migration | `20260130000000_lock_public_function_execute.sql` — **written, dry-run verified, NOT applied** |
| `REGISTRATION_ALLOWED_EMAILS` | set in Vercel production + mirrored to gitignored `.env.local` (3 addresses) |
| `INTERNAL_ORIGIN`, `INTERNAL_TRIGGER_SECRET` | set (32-byte random) |
| `CRON_SECRET` | already present, untouched |
| `REPORTS_API_KEY` | deliberately unset locally → `/api/mcp`, `/api/v1/*` fail closed with 503 |
| Live DB users / profiles | 2 / 2 (the verification account was deleted after use) |
| Storage buckets | **0** — no bucket exists, so there is no public-bucket PII exposure |
| `storage.objects` policies | none; all storage tables have RLS enabled |

---

## 6. Required before "fully secure" can be claimed

1. **Apply Plan C** (`20260130000000_lock_public_function_execute.sql`) to the
   live database → closes §2.1, §2.2, §2.3, §2.4, §2.5. *Needs approval.*
2. **Re-run the anonymous RPC probe set** after Plan C; every function must
   answer 401/403/404 instead of 200/204.
3. **Re-run the full production probe set** (admin 200 / employee 403 / anon 401)
   and the regression suite after Plan C.
4. Decide on **Plan A** (history rewrite) and **Plan B** (key rotation) — both
   are optional on current evidence, and the reasoning is recorded in
   `audit/20_REMEDIATION_PLANS.md`.

Until step 1 is done, an unauthenticated caller can create orders and read the
encrypted integration credential through PostgREST.

---

## 7. Repository discrepancy (unchanged, still open)

The user-stated repository is `anasmohamed/el-nour-dashboard`; the **actual
remote** is `git@github.com:AN2Sv772/el-nour.git` and it is **public**. All
work in this round was performed against the actual remote. If the intended
repository is a different one, the entire history/push target must be
re-pointed before any further publishing.
