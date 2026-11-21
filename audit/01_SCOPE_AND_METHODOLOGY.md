# Scope, Method and Evidence Standard

## 1. Target

| Item | Value |
|---|---|
| Working tree | `/Volumes/1/el nour dashboard/el-nour-dashboard` |
| Production | `https://el-nour-dashboard.vercel.app` (Vercel, Hobby plan → daily cron only) |
| Data platform | Supabase project `lyswmlmrlviptprhfiph` (PostgreSQL + Auth + PostgREST) |
| External service | EasyOrders Public API `https://api.easy-orders.net/api/v1/external-apps`, store `3fb15a96-d8ec-43cf-bbcf-4e5711d37f43` (`store-elnour`) |
| Version control | **none** — the directory is not a git repository |
| Review date | 2026-11-20 (Cairo) |

## 2. In scope

1. Every HTTP route under `src/app/api/**` (33 route files, 68 handler/method combinations).
2. `src/middleware.ts` (gating, rate limiting, public-route list).
3. The authentication and role model (`requireUser`, `requireRole`, `user_profiles.role`).
4. The database: schema, RLS policies, column privileges, referential and arithmetic integrity.
5. The EasyOrders integration (webhook receiver, import workers, configuration, credentials).
6. The cron surface (`/api/integrations/order-confirmation/cron`, `/catch-up`, `/process-queue`).
7. The browser application: 13 routes, accessibility semantics, responsive behaviour at
   320 / 390 / 768 / 1024 / 1444 / 1920 px, console errors, network failures.
8. Exports (Excel/CSV) and their agreement with the on-screen data.
9. Date and time-zone semantics (Africa/Cairo) across list, dashboard, reports and export.
10. Environment and secret handling (`.env.local`, encryption key, in-repo secrets).

## 3. Out of scope (and why)

| Excluded | Reason |
|---|---|
| EasyOrders platform internals | not observable from this side of the boundary |
| Vercel project configuration beyond the deployed runtime | Hobby-plan log retention is 30 minutes; no historical access |
| Real customer data semantics (who ordered what) | privacy — only aggregate and structural properties were examined |
| Penetration of third-party services | out of authorisation |
| Destructive migrations | no migration was executed without explicit approval |

## 4. Method

### 4.1 Roles used

| Identity | How |
|---|---|
| anonymous | no cookie |
| invalid cookie | `sb-…-auth-token=base64-not-a-real-session` |
| viewer | real Supabase user `audit-probe-viewer@elnour.test` (role `viewer`) — **deleted at the end of the run** |
| employee | `an2s.q.3@gmail.com` (role `employee`) |
| admin | `an2s.q.11@gmail.com` (role `admin`) |

Sessions were minted through Supabase's own magic-link admin flow (`/auth/v1/admin/generate_link`
+ `/auth/v1/verify`) and delivered as the `sb-<ref>-auth-token` cookie envelope that
`@supabase/ssr` expects (base64url payload).

### 4.2 Probe harness

`audit/evidence/probe_api.py` — 538 planned probes:

* every route path × every implemented method × 5 identities;
* wrong-method probes (`GET` on a POST-only route, …);
* malformed payloads (bad UUID, bad dates, unbounded page size, injection strings in the
  search and sort parameters, unknown JSON keys);
* a **state guard**: `BLOCKED_MUTATIONS` + `is_blocked()` refuse to send any probe that can
  change production state; a blocked probe is recorded as `BLOCKED` but never transmitted
  (`AUDIT_ALLOW_DESTRUCTIVE=1` is the only way to run one).

### 4.3 Two-code-line comparison

| Code line | Probe file | Purpose |
|---|---|---|
| production (pre-fix) | `audit/evidence/api_probe_results.production.json` | baseline |
| local dev server (post-fix) | `audit/evidence/api_probe_results.local-fixed.json` | regression proof |

The same harness, the same identities and the same payloads were used for both, so the
status distributions are directly comparable.

### 4.4 Database inspection

Read-only PostgREST queries with the service role, plus `BEGIN/ROLLBACK`-style scoping
where a write was unavoidable (all such writes were made by the audit itself and removed
afterwards). 28 integrity checks were executed — see `audit/10_DATA_INTEGRITY.md`.

### 4.5 Browser inspection

Playwright against the production build with a real admin session: per-route DOM
inspection (accessible names, label binding, heading structure, landmarks, `lang`,
skip link), responsive measurements at six widths, console-error capture and a
network-request audit.

## 5. Classification standard

| Status | Meaning |
|---|---|
| PASS | the expected behaviour was observed |
| FAIL | the expected behaviour was violated |
| PARTIAL | correct for part of the surface or only under specific conditions |
| BLOCKED | the check could not be executed (safety guard, missing access, external constraint) |
| NOT IMPLEMENTED | the feature does not exist in the reviewed build |

Every check carries a test id (`SEC-xx`, `API-xx`, `DB-xx`, `UI-xx`, `EXP-xx`, `PERF-xx`),
the observed evidence and, where it applies, a bug id (`F-xxx`).

## 6. Deviations from the audit skill (declared, not hidden)

| Skill rule | What was done | Why |
|---|---|---|
| "do not probe production" | production **was** probed | the owner explicitly authorised a live audit of their own production; every mutation was guarded |
| "use sub-agents for parallel units" | all units were executed by the parent agent | the delegation backend returned HTTP 529 for every attempt |
| "capture screenshots as evidence" | DOM/textual evidence was used | screenshot capture is unavailable in this environment |
| "do not modify the target" | the target was modified (repair phase) | the task is audit → repair → re-verification; no deployment was performed |

## 7. Evidence index

| File | Content |
|---|---|
| `audit/evidence/api_probe_results.production.json` | 538 planned / 429 sent probes against production |
| `audit/evidence/api_probe_results.local-fixed.json` | the same harness against the repaired build |
| `audit/evidence/api_probe_status_counts.json` | status distribution of the production run |
| `audit/evidence/api_probe_results.run1-INC001.json` | the pre-guard run that caused INC-001 |
| `audit/evidence/db_integrity_report.json` | 28 integrity checks with counts and examples |
| `audit/evidence/db_integrity_check.py` | the checker (read-only) |
| `audit/evidence/cleanup_audit_residue.py` + `cleanup_report.json` | what was deleted and the before/after counts |
| `audit/evidence/ui_audit.json` / `ui_audit_summary.json` | per-route accessibility and structure measurements |
| `audit/evidence/export_probe.json` | export behaviour and the row-count disagreement |
| `audit/evidence/performance_probe.json` | latency distribution of 89 admin probes |
| `audit/evidence/api_matrix.md` | endpoint × identity status matrix (68 rows) |
| `audit/evidence/probe_api.py` | the harness itself, including the safety guard |
| `~/security-audit-skill/el-nour-dashboard/run-1/` | `findings.json`, `coverage-ledger.json`, `run-metadata.json`, `architecture.md` (validators: PASS) |
