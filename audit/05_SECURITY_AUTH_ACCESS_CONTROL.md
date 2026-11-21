# Security — Authentication, Authorisation and Access Control

Scope: `src/middleware.ts`, `src/lib/supabase/require-user.ts`, `require-role.ts`,
`src/app/api/**` role gates, the Supabase RLS policies and the role model itself.

---

## 1. Authentication

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| SEC-01 | `GET /api/orders` without a cookie | 401 JSON | 401 `{"error":"Unauthorized"}` | PASS |
| SEC-02 | `GET /api/orders` with a forged cookie | 401 JSON | 401 | PASS |
| SEC-03 | any page route without a session | redirect to `/login?redirectTo=…` | 302 → `/login` | PASS |
| SEC-04 | authenticated user opening `/login` | redirected to `/dashboard` | 302 | PASS |
| SEC-05 | session verification | the token is verified against the Supabase Auth server, not decoded | `requireUser()` calls `auth.getUser()`; a self-signed token is rejected | PASS |
| SEC-06 | session refresh race | the server must not refresh the session | the middleware reads the cookie only (`getSession()`), the browser client is the single refresher | PASS |
| SEC-07 | forged `Authorization: Bearer` header | ignored in favour of the cookie | the routes read the cookie only | PASS |
| SEC-08 | expired session | rejected | the access token is verified server-side; expired tokens fail `getUser()` | PASS |

**Positive note.** The middleware explicitly documents why it must not call `getUser()`:
the server and the browser would race on the same single-use refresh token and the loser
deletes the session cookies. That is the correct design and it is worth keeping.

## 2. Role model

| Role | Intended | Enforced by |
|---|---|---|
| viewer | read business data | `requireRole('viewer')` |
| employee | create/update business data | `requireRole('employee')` |
| manager | destructive business actions | `requireRole('manager')` |
| admin | integrations, settings, users | `requireRole('admin')` |

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| SEC-10 | viewer reading `/api/orders`, `/api/customers`, `/api/products`, `/api/dashboard/*` | 200 | 200 | PASS |
| SEC-11 | viewer writing `/api/export/excel` | 403 | 403 (the export contains names, phones, addresses) | PASS |
| SEC-12 | viewer triggering the import workers | 403 | 403 after the fix (was 200 → **F-008**) | PASS (fixed) |
| SEC-13 | employee on admin-only integration routes | 403 | 403 for writes; 200 for reads that the role model allows | PASS |
| SEC-14 | invalid/tampered role values | rejected | only the four known roles exist; no unknown role was observed in `user_profiles` | PASS |
| SEC-15 | `GET /api/settings` as viewer | 403 (by design) | 403 — **asymmetry with the other read endpoints** | see F-014 |
| SEC-16 | `user_profiles.role` is writable by a client | no | the role column is not writable through the anon key; RLS blocks it | PASS |

## 3. Middleware gate vs. route authorisation

The middleware only checks **cookie presence**; every real decision is taken inside the
route handler by `requireUser()` / `requireRole()`. This split is correct (the middleware
runs at the edge, the handler knows the resource), and it was verified by sending requests
with a *valid-format but wrong* cookie: all of them were rejected with 401 by the handler.

One consequence must be stated plainly: **every route handler uses the service-role
client**, so the database RLS policies do not apply to API traffic — the role gate in the
handler is the only application-level authorisation. A single missing `requireRole` call
is therefore a complete authorisation bypass. That is exactly what happened in F-008.

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| SEC-20 | every mutating route has a role gate | no unguarded writer | all 68 handler/method combinations were probed with the viewer identity; the only unguarded writers were the four EasyOrders workers (F-008) | PASS after fix |
| SEC-21 | worker routes after the fix | admin only | `/catch-up`, `/backfill`, `/process-queue`, `/sync` → 403 for viewer/employee | PASS |
| SEC-22 | destructive integration disconnect | confirmation required | now requires `{"confirm":"disconnect"}` → 400 otherwise (F-006) | PASS |
| SEC-23 | import-test endpoint | opt-in | 403 unless `ALLOW_EASYORDERS_IMPORT_TEST=1` (F-007) | PASS |

## 4. Database-level access control

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| SEC-30 | RLS enabled on the business tables | yes | policies aligned with the application role model by migration `20260120000000_align_rls_with_app_roles.sql` | PASS |
| SEC-31 | `easyorders_config` readable by a client role | admin only | column-level privileges revoked by `20260121000000_lock_easyorders_config_privileges.sql`; the earlier `REVOKE` was a **no-op** under the table-level `GRANT` (F-005) | PASS after fix |
| SEC-32 | `audit_log` immutability | no delete for any role | `DELETE` → `permission denied for table audit_log` (42501) even with the service role | PASS |
| SEC-33 | cross-user data access (one employee reading another employee's data) | no business ownership model exists | not applicable — the store is a single-tenant shared workspace, every employee sees the whole book | N/A |

## 5. Sessions and identities used in this audit

| Identity | Role | Purpose | Status |
|---|---|---|---|
| `an2s.q.11@gmail.com` | admin | admin matrix, destructive routes | kept |
| `an2s.q.3@gmail.com` | employee | employee matrix, export | kept |
| `audit-probe-viewer@elnour.test` | viewer | viewer matrix | **temporary — deleted at the end of the run** |
| forged / invalid cookie | — | negative matrix | n/a |

## 6. Residual risks

1. **The role gate is the only line of defence for API traffic** (service-role client).
   A code-review rule should require a `requireRole` call in every new route handler.
2. **F-014** — the settings endpoint is stricter than its peers. Until the owner decides,
   the asymmetry stays; it is a usability question, not a security hole.
3. The `audit_log` immutability is enforced by the database, not by the application: a
   migration with the right privileges could still rewrite history. Worth a periodic
   review of who holds the service-role key.
