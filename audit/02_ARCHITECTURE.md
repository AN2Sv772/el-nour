# El Nour Dashboard — Architecture (audit run 1)

**Target:** `/Volumes/1/el nour dashboard/el-nour-dashboard`
**Production:** https://el-nour-dashboard.vercel.app (Vercel, Hobby plan — daily cron only)
**Data:** Supabase project `lyswmlmrlviptprhfiph` (PostgreSQL + Auth + PostgREST)
**External:** EasyOrders Public API `https://api.easy-orders.net/api/v1/external-apps`
**Reviewed state:** working tree of 2026-11-20 (the project is **not** under version control)

---

## 1. Shape of the system

```
Browser (React / Next.js App Router)
   │  session cookie: sb-<ref>-auth-token (JWT)
   ▼
Vercel edge ── src/middleware.ts
   │           ├─ public route list (webhook, queue workers, cron)
   │           ├─ session presence gate (401 JSON for /api, redirect for pages)
   │           └─ in-memory rate limiter (100 GET/min, 30 write/min per ip+path)
   ▼
Next.js route handlers (src/app/api/**)   ~33 route files / ~68 handlers
   │  ├─ requireUser()  – cookie → Supabase Auth → user_profiles.role
   │  ├─ requireRole(role) – viewer | employee | manager | admin
   │  ├─ zod validation (src/lib/validation.ts)
   │  └─ shared query layer (src/lib/orders/query.ts, src/lib/date-range.ts,
   │                          src/lib/api-params.ts, src/lib/supabase/paginate.ts)
   ▼
Supabase service client (service_role) ──► PostgreSQL
   │                                         ├─ RLS policies (app_role_rank / app_has_role)
   │                                         └─ column privileges (easyorders_config)
   ▼
EasyOrders Public API  ── Api-Key header ──► products / orders / webhooks
EasyOrders platform    ── secret header  ──► POST /api/integrations/easyorders/webhook
```

## 2. Entry surfaces

| Surface | Path / mechanism | Auth by construction | Notes |
|---|---|---|---|
| HTTP API | `src/app/api/**/route.ts` | cookie session + `requireRole` | the main attack surface |
| Edge middleware | `src/middleware.ts` | cookie presence only (no signature check) | gating + rate limiting |
| Direct database | PostgREST `https://<ref>.supabase.co/rest/v1/*` | anon key + RLS + column grants | reachable from the browser |
| Supabase Auth | `/auth/v1/*` | email + password | registration, reset |
| Webhook | `POST /api/integrations/easyorders/webhook` | shared `secret` header | public path, own gate |
| Cron | `GET /api/integrations/easyorders/catch-up`, `POST …/process-queue` | `Authorization: Bearer $CRON_SECRET` | daily schedule (Hobby plan) |
| Internal trigger | `x-queue-trigger` header on `process-queue` | derived from `CRON_SECRET` | self-chaining worker |
| EasyOrders API | `Api-Key: <key>` outbound | encrypted at rest (AES-256-GCM) | key identifier `93a4…2fcc` |
| Build | `next build` on Vercel | environment variables | no repository / commit pinning |

## 3. Role model

| Role | Intended capability | Enforced by |
|---|---|---|
| `viewer` | read business data | `requireRole('viewer')` on read routes |
| `employee` | create/update business data | `requireRole('employee')` |
| `manager` | destructive business actions (cancel, void, bulk) | `requireRole('manager')` |
| `admin` | integrations, settings, users | `requireRole('admin')` |

Roles live in `user_profiles.role` and are resolved by `src/lib/supabase/require-role.ts`
through `public.app_role_rank()` / `public.app_has_role(text)` in the database.
Every API route uses the **service role** client for data access, so the role gate in
the handler is the only application-level authorisation — the database RLS policies
protect direct PostgREST access, not the route handlers.

## 4. Data model (business tables)

`orders` (2015) · `order_items` (2015) · `customers` (1915) · `products` (12) ·
`expenses` (1, soft-void) · `collection_batches` / `collection_allocations` ·
`daily_reconciliations` · `inventory_movements` · `knowledge_base` ·
`order_confirmations` / `order_confirmation_events` · `notifications` ·
`automation_logs` · `audit_log` · `easyorders_config` · `easyorders_sync_logs` ·
`easyorders_webhook_events` · `user_profiles`

Money is stored in EGP as `numeric`; COGS is captured per line as `unit_cost`
(all products currently carry `cost_price = 0`, so gross profit equals net of the
recorded expenses only — a data-completeness limitation, not a code defect).

## 5. Trust boundaries and where they were weak

| # | Boundary | Weakness found in this run |
|---|---|---|
| B1 | internet → edge | rate limiter store grew without bound; limiter is per instance, not global |
| B2 | edge → app | worker routes reachable by a read-only role; destructive DELETE without confirmation |
| B3 | app → database | column-level `REVOKE` was a no-op under a table-level `GRANT` |
| B4 | app → EasyOrders | the API-key identifier was the only copy of the credential and could be wiped |
| B5 | browser → database | RLS now aligned with the application role model (verified by identity matrix) |
| B6 | deploy → runtime | no source revision pinning; local env had a duplicated encryption key |

## 6. How the audit was executed

* **Probe harness** — `audit/evidence/probe_api.py`: 538 probes = 33 route paths ×
  methods × five identities (anon, invalid cookie, viewer, employee, admin) plus
  wrong-method probes, with malformed payloads.
* **Safety guard** — added after incident INC-001: every mutating endpoint that can
  change production state is blocked at the transport layer; a blocked probe is
  recorded but never sent (`AUDIT_ALLOW_DESTRUCTIVE=1` is required to run one).
* **Two code lines** — production (pre-fix) and local dev server (post-fix) were
  probed with the identical harness, which produced the status-distribution
  comparison used as regression evidence.
* **Database integrity** — read through the service role REST API; write probes were
  scoped to rows the audit itself created and were removed afterwards.

## 7. Known limitations of this run

* The project is not a git repository, so no commit can be cited as the reviewed
  revision and no version-control rollback exists.
* Sub-agents could not be used (the delegation backend returned HTTP 529 throughout),
  so every unit was executed by the parent agent; the coverage ledger records that
  limitation instead of hiding it.
* The local development key differs from the production encryption key, so the
  encrypted paths could not be exercised locally — they were verified against
  production instead.
* EasyOrders delivery behaviour can only be observed from the EasyOrders side.
