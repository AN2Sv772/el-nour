# Technical report — El Nour Business OS

**Date** — 2026-11-21 · **Stack** — Next.js 16 (App Router) · React 19 ·
TypeScript (strict) · Supabase (Postgres + Auth + RLS) · Tailwind · Vitest ·
Playwright · Vercel.

---

## 1. Architecture

```
                    ┌──────────────────────────────────────┐
  browser  ───────► │  App Router (RSC + client islands)   │
                    │  /dashboard /overview /briefing /risk │
                    │  /anomalies /forecast /simulator      │
                    │  /setup/costs /brain /agent /decisions│
                    └───────────────┬──────────────────────┘
                                    │  (session cookie → RLS)
                    ┌───────────────▼──────────────────────┐
                    │  API routes (requireRole)             │
                    │  /api/overview /api/briefing          │
                    │  /api/intelligence/*                  │
                    │  /api/metrics/* /api/analytics        │
                    │  /api/ai/* /api/brain/*               │
                    │  /api/v1/* (x-api-key, read-only)     │
                    │  /api/mcp (JSON-RPC 2.0, read-only)   │
                    └───────────────┬──────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
 ┌─────────────┐          ┌──────────────────┐        ┌──────────────────┐
 │  ENGINES    │          │  SUPABASE        │        │  AI LAYER        │
 │  pure TS    │          │  service role    │        │  intent → tools  │
 │  metrics    │          │  (SELECT only    │        │  → answer        │
 │  analytics  │          │   on the read    │        │  → approvals     │
 │  overview   │          │   paths)         │        │  (propose only)  │
 │  decisions  │          │                  │        │  provider: opt-in│
 │  risk       │          │  RLS on every    │        │  deterministic   │
 │  anomaly    │          │  write path      │        │  without a key   │
 │  forecast   │          │                  │        │                  │
 │  simulator  │          └──────────────────┘        └──────────────────┘
 │  briefing   │
 └─────────────┘
```

**The dependency rule** — the engines never import the database and the AI
layer never computes. `src/lib/**` engines are pure functions over typed
inputs; the server layer (`src/lib/intelligence/server.ts`, the API routes)
is the only place that reads the database. This is what makes the engines
testable without a database, and it is what keeps the AI from inventing
numbers.

## 2. The modules that matter

| module | files | role |
|--------|-------|------|
| Metrics | `src/lib/metrics/{engine,calculations,types}.ts` | every headline number with its provenance |
| Overview | `src/lib/overview/engine.ts` | the cockpit: six headline numbers, the breakdown, the health verdict |
| Analytics | `src/lib/analytics/{finance,engine}.ts` | the income statement, the cash flow, the unit economics |
| Decisions | `src/lib/decisions/{engine,rules,types}.ts` | ten rules, each with the numbers that triggered it |
| Intelligence | `src/lib/intelligence/{risk,anomaly,forecast,simulator,briefing,server}.ts` | the four new analytic engines |
| AI | `src/lib/ai/{intent,tools,answer,approvals,actions,provider}.ts` | the agent: intent → tool → answer → (approval) |
| Setup | `src/lib/setup/cost-coverage.ts` | the cost gate: what is missing, what it would unlock |
| API surface | `src/app/api/**` | thin, role-checked wrappers over the engines |

**Shared primitives** — `src/lib/finance.ts` (`round2`), `src/lib/date-range.ts`
(Africa/Cairo windows), `src/lib/supabase/paginate.ts` (`fetchAllRows`, 1000/page),
`src/lib/supabase/require-role.ts` (`admin|manager|employee|viewer`),
`src/lib/utils.ts` (one formatter for every number in the app).

## 3. Security posture

| concern | state | evidence |
|---------|-------|----------|
| RLS | enabled, never disabled; `supabase/migrations/20260120000000_align_rls_with_app_roles.sql` aligns the policies with the app roles | the audit documents in `audit/` |
| Secrets | server-side only; the browser never sees `REPORTS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CREDENTIALS_ENCRYPTION_KEY` | `.env.local` is not public; the key check is `process.env` on the server |
| API key comparison | constant-time (`timingSafeEqual`), and an unconfigured key answers **503**, never "open" | `src/lib/api/api-key.ts` |
| External API | read-only by construction: no write tool is exposed in `/api/v1` or `/api/mcp` | the routes only SELECT |
| Role checks | every write route calls `requireRole` **at execution time**, not only at proposal time | `src/lib/supabase/require-role.ts` |
| Idempotency | approvals carry an idempotency key; a second execution is refused | `src/lib/ai/approvals.ts` |
| AI credentials | AES-256-GCM at rest, decrypted only in the server | `src/lib/ai/provider.ts` + its 9 tests |
| Webhook | EasyOrders signature verified, atomic order sync, the config table locked | `20260122000000_easyorders_atomic_sync_log.sql` |
| Missing tables | a missing table produces an actionable 503 that names the migration | `src/lib/api/missing-table.ts` (this session) |

**No destructive migration exists.** The three pending migrations are additive
(`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

## 4. Performance

| endpoint | before | after | how |
|----------|-------:|------:|-----|
| `/api/metrics/overview` | 9.37 s | **2.47 s** cold · **0.35 s** cached | parallel current/previous window reads + a 20-second in-process cache (max 60 entries) |
| `/api/briefing` | 5.56 s | **2.89 s** | parallel reads (overview + today + orders) |
| `/api/overview` | — | within the same envelope | same engine, same cache |

The cache never changes the arithmetic: it stores the computed result and is
invalidated explicitly (`invalidateOverviewCache`).

## 5. Test posture

| layer | count | command |
|-------|------:|---------|
| Unit (pure engines, formatters, the AI provider with a mock HTTP server) | **449** across 37 files | `npx vitest run` |
| End-to-end (Playwright, the real database, a minted admin session) | **34** (28 desktop + 6 mobile) | `npx playwright test` |
| Types | clean | `npx tsc --noEmit` |
| Production build | clean, 24 routes | `npm run build` |

The e2e suite fails a test on **any console error** and on **any 5xx
response**, so a React key warning or a broken route cannot pass silently.
The selectors are role/label based, not CSS classes.

**What the e2e run found and fixed** — see `replica/bugs.md`: a duplicated
React key that dropped a briefing row (B02), two spellings of the same money
figure on two screens (B01), and an unusable error message for a missing
table (B03).

## 6. API surface

| surface | auth | method | notes |
|---------|------|--------|-------|
| `/api/v1/*` | `x-api-key` / `Bearer` | GET | read-only; 503 when the key is not configured, 401 when it is wrong |
| `/api/mcp` | `x-api-key` | POST | JSON-RPC 2.0; three tools — `get_business_metrics`, `get_product_economics`, `get_decisions` — all backed by the same engines as the screens |
| `/api/overview` · `/api/briefing` · `/api/intelligence/*` | session + `requireRole('viewer')` | GET | the new screens' data |
| `/api/intelligence/simulator` | session + `requireRole('viewer')` | POST | a **read-only** simulation: it computes, it never writes |
| `/api/ai/approvals` | session + `requireRole('employee'/'admin')` | GET/POST | 503 with the migration name until the migration is applied |

## 7. Known gaps (code-side)

| gap | why it is still open |
|-----|----------------------|
| the brain tables are not applied to production | access (Supabase CLI 403, no `psql`, no Management token) — the owner applies `supabase/pending-migrations.sql` |
| the AI provider is not configured | no key and no provider choice yet; the deterministic path answers without one |
| no write path for the cost screen in the e2e suite | the suite would change the owner's real cost data — it needs an explicit approval to run |
| weekly/monthly scheduled reports and the delivery channel | no channel provider (WhatsApp/email) |
| customer analytics deep-dive | needs the customer-level tables to be filled by real usage |
| the PWA/offline shell and voice input | out of the current scope |

## 8. Deployability

- The build is clean and the project is linked to Vercel (`el-nour-dashboard`).
- `REPORTS_API_KEY` is set as a Production secret; `CREDENTIALS_ENCRYPTION_KEY`
  and `CRON_SECRET` already exist.
- **Nothing was deployed in this session** — the master prompt's §22 forbids
  an automatic deploy. The deploy is one explicit command away and waits for
  the owner's approval.
