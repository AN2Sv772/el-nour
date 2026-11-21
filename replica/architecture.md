# Architecture: El Nour Business OS (a transformation of El Nour, shaped by Analify's architecture)

> Built with the `replica-architect` workflow. Reads `replica/recon.md` and
> `replica/features.csv`. The SQL in §2 is the real migration set, applied in
> the order given.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js 16 App Router + React 19 + TypeScript (existing) | already deployed, already audited; the transformation must not risk the working business app |
| styling | Tailwind v4 `@theme` tokens (existing `src/app/globals.css`) | one token file, dark mode already measured for WCAG AA |
| components | Radix primitives + local `src/components/ui` (existing) | accessible bases without a new dependency |
| charts | Recharts (existing) | already used for the sales chart |
| database | Supabase Postgres (existing, one project) | one database, no second store of truth |
| auth | Supabase Auth + `@supabase/ssr` (existing) | session handling, RLS, and the service-role client pattern already in place |
| AI | provider abstraction → any OpenAI-compatible / Anthropic / Gemini endpoint | the owner brings one key; no vendor is hardcoded |
| jobs | Vercel Cron (existing daily cron) + route handlers | no new infrastructure on a Hobby plan |
| files | Supabase Storage bucket `business-knowledge` | for uploaded supplier lists / statements |
| hosting | Vercel (existing) | deployment stays manual and gated by the owner |

**Deliberately unchanged:** EasyOrders remains the only source of orders.
Supabase remains the only source of truth for money. No second accounting
system is introduced.

## Schema

Tables: **28 existing** (verified by reading every migration) → **+16 new**.
Access rules: **both** — Postgres RLS on every new table *and* an application
role check in the route layer (`requireRole`), because every API route reads
through the service-role client that bypasses RLS.

### Tenant model

El Nour is a **single-store deployment**: one `business_settings` row is the
tenant. There is no second tenant to isolate, so the new tables are
store-scoped by construction rather than by an `org_id` column that would
carry a constant. If a second store is ever onboarded, the isolation column
is added in one migration — the tables already carry `created_by` /
`approved_by` for the audit trail.

### New tables

```sql
-- ── Business Brain ────────────────────────────────────────────────────────
create table business_profile (            -- 1 row, like business_settings
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  website text,
  description text,
  description_ar text,
  industry text,
  market text,
  currency text not null default 'EGP',
  timezone text not null default 'Africa/Cairo',
  goals_summary text,
  sales_channels text[] not null default '{}',
  connected_platforms jsonb not null default '{}'::jsonb,
  primary_focus text,                     -- growth | profit | cash
  cash_floor numeric(12,2),               -- never let cash drop below this
  max_daily_ad_spend numeric(12,2),
  hard_constraints text[] not null default '{}',
  never_rules text[] not null default '{}',
  status text not null default 'incomplete'
    check (status in ('not_configured','incomplete','learning','ready','needs_attention','outdated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_knowledge (
  id uuid primary key default gen_random_uuid(),
  topic text not null,                    -- one of the 24 topics
  title text not null,
  body text not null,
  kind text not null default 'fact'
    check (kind in ('fact','rule','goal','profile','note','extracted')),
  source_kind text not null
    check (source_kind in ('owner','file','data','decision','ai_read','chat','import')),
  source_ref jsonb not null default '{}'::jsonb,
  confidence numeric(3,2) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  status text not null default 'unverified'
    check (status in ('unverified','verified','conflicted','outdated','forgotten')),
  -- an AI-generated item can never be born verified
  verified_by uuid references user_profiles(id),
  verified_at timestamptz,
  last_checked_at timestamptz,
  check_in_months integer,                -- yearly / quarterly re-confirmation
  effective_until timestamptz,            -- "rules that end"
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_cannot_be_verified
    check (source_kind <> 'ai_read' or status <> 'verified')
);

create table business_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references business_knowledge(id) on delete cascade,
  source_kind text not null,
  source_ref text,
  file_name text,
  extracted_summary text,
  review_status text not null default 'pending'
    check (review_status in ('pending','accepted','rejected')),
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);

create table business_goals (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,               -- revenue | net_profit | ad_spend | margin | return_rate | stock
  target numeric(14,2) not null,
  unit text not null default 'currency',
  period text not null default 'monthly' check (period in ('daily','weekly','monthly','quarterly','yearly')),
  note text,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,                     -- natural language
  scope text not null default 'general',
  priority integer not null default 100,
  is_active boolean not null default true,
  effective_from timestamptz,
  effective_until timestamptz,
  source_knowledge_id uuid references business_knowledge(id) on delete set null,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_brain_questions (
  id uuid primary key default gen_random_uuid(),
  question_key text not null unique,      -- e.g. target_margin
  topic text not null,
  prompt text not null,
  prompt_ar text not null,
  why_it_matters text not null,
  area text not null,                     -- the 8 training areas
  required boolean not null default true,
  check_in_months integer,                -- null = never auto-returns
  answer text,
  answer_source text not null default 'owner'
    check (answer_source in ('owner','data','ai_read','file')),
  status text not null default 'open'
    check (status in ('open','answered','skipped')),
  answered_by uuid references user_profiles(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_brain_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running','succeeded','failed','stopped')),
  step text,                             -- read_data | study_areas | check_results | report
  areas_learned text[] not null default '{}',
  facts_kept integer not null default 0,
  answers_dropped integer not null default 0,
  coverage_before numeric(5,2),
  coverage_after numeric(5,2),
  report jsonb not null default '{}'::jsonb,
  error text,
  started_by uuid references user_profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ── AI agent ──────────────────────────────────────────────────────────────
create table ai_provider_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null                  -- openai_compatible | anthropic | gemini
    check (provider in ('openai_compatible','anthropic','gemini')),
  label text not null,
  model text not null,
  base_url text,
  api_key_ciphertext text not null,       -- encrypted with CREDENTIALS_ENCRYPTION_KEY
  is_default boolean not null default false,
  max_tokens integer not null default 2000,
  temperature numeric(3,2) not null default 0.2,
  request_limit_per_minute integer not null default 10,
  timeout_ms integer not null default 60000,
  max_retries integer not null default 2,
  is_active boolean not null default true,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  context jsonb not null default '{}'::jsonb,  -- page, entity, entity_id
  status text not null default 'active' check (status in ('active','deleted')),
  message_count integer not null default 0,
  created_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  body text not null,
  answer_status text check (answer_status in
    ('answered','partially_answered','insufficient_data','unable_to_retrieve','calculation_unavailable','failed')),
  evidence jsonb not null default '{}'::jsonb,   -- numbers, calculation, sources, missing
  charts jsonb not null default '[]'::jsonb,
  tables jsonb not null default '[]'::jsonb,
  follow_ups text[] not null default '{}',
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create table ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references ai_messages(id) on delete cascade,
  conversation_id uuid references ai_conversations(id) on delete cascade,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'ok' check (status in ('ok','error','denied')),
  error text,
  duration_ms integer,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);

create table ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  user_id uuid references user_profiles(id),
  conversation_id uuid references ai_conversations(id) on delete set null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric(10,6) not null default 0,
  duration_ms integer,
  status text not null default 'ok',
  created_at timestamptz not null default now()
);

-- ── Approvals & execution ────────────────────────────────────────────────
create table ai_approvals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references ai_conversations(id) on delete set null,
  message_id uuid references ai_messages(id) on delete set null,
  action_type text not null,              -- expense.create | product.cost.update | order.update ...
  title text not null,
  rationale text not null,
  payload jsonb not null default '{}'::jsonb,
  affected_records jsonb not null default '{}'::jsonb,
  expected_impact jsonb not null default '{}'::jsonb,
  severity text not null default 'change'
    check (severity in ('notification','change','stops_now','hard_to_undo')),
  reversible boolean not null default false,
  rollback_note text,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','rejected','executing','completed','failed','expired')),
  idempotency_key text not null unique,   -- a second execution can never happen
  required_role text not null default 'admin',
  requested_by uuid not null references user_profiles(id),
  approved_by uuid references user_profiles(id),
  approved_at timestamptz,
  rejected_reason text,
  executed_at timestamptz,
  result jsonb,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_execution_logs (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references ai_approvals(id) on delete cascade,
  idempotency_key text not null unique,
  attempt integer not null default 1,
  status text not null check (status in ('running','completed','failed')),
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  error text,
  executed_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);

-- ── Reports, decisions, connections ───────────────────────────────────────
create table scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  report_type text not null
    check (report_type in ('daily','weekly','monthly','financial','sales','inventory','courier','advertising','ai_summary')),
  schedule jsonb not null,                -- {kind:'daily',hour:9,minute:0}
  timezone text not null default 'Africa/Cairo',
  recipients text[] not null default '{}',
  metrics text[] not null default '{}',
  channel text not null default 'email' check (channel in ('email','whatsapp','pdf','excel')),
  is_active boolean not null default true,
  last_execution_at timestamptz,
  next_execution_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table report_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references scheduled_reports(id) on delete cascade,
  period_from timestamptz,
  period_to timestamptz,
  status text not null default 'pending'
    check (status in ('pending','sent','failed','skipped')),
  provider text,
  provider_message_id text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table business_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  recommendation text,
  decision text not null,
  decided_by uuid references user_profiles(id),
  decided_at timestamptz not null default now(),
  approval_id uuid references ai_approvals(id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references business_decisions(id) on delete cascade,
  window_days integer not null default 7,
  metrics_before jsonb not null default '{}'::jsonb,
  metrics_after jsonb not null default '{}'::jsonb,
  status text not null default 'measuring'
    check (status in ('measuring','measured','not_measured','could_not_measure')),
  note text,
  created_at timestamptz not null default now()
);

create table external_api_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,        -- sha256; the raw token is shown once
  prefix text not null,
  scopes text[] not null default '{read}',
  created_by uuid not null references user_profiles(id),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table advertising_accounts (       -- empty until a real connection exists
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta','tiktok','google','snapchat')),
  external_id text not null,
  name text not null,
  currency text not null default 'EGP',
  status text not null default 'disconnected'
    check (status in ('connected','disconnected','error','rate_limited')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
```

**Hard constraints found in the recon that become database constraints:**

| constraint | how |
| --- | --- |
| an AI read can never be a verified fact | `check (source_kind <> 'ai_read' or status <> 'verified')` |
| an action can execute only once | `unique` idempotency key on `ai_approvals` **and** `ai_execution_logs` |
| a verified answer needs a verifier and a time | application rule + `verified_by` / `verified_at` |
| a scheduled report needs a timezone | `not null` + default `Africa/Cairo` |
| one business profile row | unique index on `(true)` (the `business_settings` pattern) |

Every new table gets: `id uuid pk default gen_random_uuid()`, `created_at`,
`updated_at` where mutable, an index on every foreign key and every column
that is filtered or sorted by, and **RLS enabled** with policies that mirror
the app's role model (`admin`/`manager` write, `employee` read, `viewer` read
for non-sensitive tables, no access to credentials/tokens for `viewer`).

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `GET /api/metrics/overview` | the executive metric set with provenance | viewer+ | `dateRange/from/to` | `BusinessOverview` | F05 |
| `GET /api/metrics/products` | product performance (margin null when cost missing) | viewer+ | range | `ProductPerformance[]` | F05 |
| `GET /api/metrics/series` | daily revenue/cost/profit series | viewer+ | range | `DailyPoint[]` | F05 |
| `GET /api/brain/profile` | business profile + operating contract | viewer+ | — | profile | F02 |
| `PUT /api/brain/profile` | save the profile / contract | admin | profile fields | profile | F02 |
| `GET /api/brain/status` | Brain status + coverage from real requirements | viewer+ | — | status, coverage, gaps | F02 |
| `POST /api/brain/audit` | run the Brain audit (coverage + gaps) | admin | — | audit report | F02 |
| `GET/POST /api/brain/knowledge` | list / add knowledge | viewer+ / employee+ | query, body | items | F02 |
| `PATCH/DELETE /api/brain/knowledge/[id]` | edit / forget | employee+ | body | item | F02 |
| `POST /api/brain/knowledge/import` | upload + parse + review (nothing saved yet) | admin | file | extracted draft | F03 |
| `POST /api/brain/knowledge/[id]/confirm` | owner confirms a draft | admin | — | item | F03 |
| `GET/PUT /api/brain/goals` | business goals | viewer+ / admin | body | goals | F02 |
| `GET/POST/PUT/DELETE /api/brain/rules` | business rules | viewer+ / admin | body | rules | F02 |
| `GET /api/brain/questions` | the question catalogue + answers | viewer+ | — | questions | F02 |
| `POST /api/brain/questions/[key]/answer` | answer / skip | admin | answer | question | F02 |
| `GET/POST /api/ai/conversations` | history / new conversation | viewer+ | — | conversations | F01 |
| `DELETE /api/ai/conversations/[id]` | delete a conversation | owner of it | — | ok | F01 |
| `POST /api/ai/chat` | ask (SSE stream) | viewer+ | question, conversation_id, context | streamed answer + evidence | F01 |
| `GET /api/ai/tools` | the tool catalogue the agent may call | viewer+ | — | tools + scopes | F01 |
| `GET/POST /api/ai/providers` | AI provider settings (key never returned) | admin | body | providers (masked) | — |
| `GET /api/approvals` | approval queue | viewer+ (own) / admin (all) | — | approvals | F04 |
| `POST /api/approvals/[id]/approve` | approve + execute | admin | — | execution result | F04 |
| `POST /api/approvals/[id]/reject` | reject | admin | reason | approval | F04 |
| `GET /api/finance/overview` | the finance model (income/expense/cash) | viewer+ | range | finance summary | F05 |
| `GET /api/finance/reports/[type]` | daily/weekly/monthly/profit-by-product/… | viewer+ | range | report rows | — |
| `GET /api/marketing/overview` | advertising state (honest when disconnected) | viewer+ | range | status + empty data | — |
| `GET /api/shipping/overview` | delivery + courier cash from real records | viewer+ | range | shipping summary | — |
| `GET/POST/PATCH /api/reports/scheduled` | scheduled reports | admin | body | schedules | F06 |
| `POST /api/reports/run/[id]` | run one report now, record the delivery | admin | — | delivery | F06 |
| `GET /api/v1/overview` | **read-only public API** (bearer token) | token | range | metrics | F07 |
| `GET /api/v1/orders` | read-only orders | token | filters | orders | F07 |
| `GET /api/v1/products` | read-only products | token | filters | products | F07 |
| `POST /api/v1/mcp` | **MCP JSON-RPC** (tools/list, tools/call) | token | JSON-RPC | MCP result | F07 |
| `GET/POST/DELETE /api/connections/tokens` | external API tokens | admin | body | token (shown once) | F07 |

Webhooks in: EasyOrders (`/api/integrations/easyorders/webhook`, existing,
idempotent) · order-confirmation callbacks (existing).
Webhooks out: none.
Jobs: daily order-confirmation cron (existing) · **new** scheduled-report
runner (Vercel cron, hourly, picks due reports) · Brain audit refresh
(on demand, plus a weekly cron).

## The parts that bite

- **Time zones:** every window is an Africa/Cairo business day. The engine is
  `src/lib/date-range.ts`; the new metric layer must not add a second date
  implementation. `previousFrom/previousTo` = the previous equal-length window
  in the same timezone.
- **Idempotency:** the EasyOrders webhook already has an idempotency guard.
  The new approval execution path gets its own `idempotency_key` unique index
  and re-checks it inside the execution transaction, so a double click cannot
  run an action twice.
- **Races:** the import counters lost 99 % of their updates because of a
  read-modify-write (audit finding F-012). The new counters — coverage,
  question counts — are computed from rows, not from a stored counter, or
  incremented atomically in the database.
- **PostgREST limits:** a plain `.select()` returns only the first 1 000 rows.
  Every aggregate in the new engine pages with `fetchAllRows` /
  `fetchAllByIds`, and chunks `in()` filters at 200 ids.
- **Service-role bypass:** every API route reads through the service-role
  client, so RLS alone protects nothing. Every new route calls `requireRole`,
  and the AI tool layer receives the caller's role and refuses anything the
  caller could not do directly.
- **AI hallucination:** an AI tool may only return values that were computed
  from rows. The provider may not invent a number; the orchestrator rejects a
  number that does not appear in a tool result.
- **Single tenancy:** one store. No `org_id`; the `business_profile` /
  `business_settings` singleton is the tenant row.
- **Money:** `numeric` in EGP (the existing tables already use `numeric` /
  `decimal`). No floating-point money in the new tables; the TypeScript layer
  rounds with `round2` (already in `src/lib/finance.ts`).
- **Rate limits:** the AI routes get their own limiter (`request_limit_per_minute`
  per provider, plus the existing middleware limiter).
- **Secrets:** provider keys are encrypted with the existing
  `CREDENTIALS_ENCRYPTION_KEY` and never returned by any endpoint.
- **File size:** uploads are capped (CSV/XLSX/PDF ≤ 10 MB) and parsed in a
  request-scoped memory limit; nothing is written to the Brain before the
  owner reviews it.

## Build order

1. **Vertical slice (Phase 1)** — `src/lib/metrics/*` (pure calculations + a
   DB engine) and `GET /api/metrics/overview`. One screen's worth of truth
   before any AI: the numbers with their provenance. Tables: none new.
   Routes: 3.
2. **Must-haves (Phase 2 — Brain)** — `business_knowledge`, `business_rules`,
   `business_goals`, `business_brain_questions`, `business_profile`,
   `business_brain_runs` + `/brain` UI + the Brain audit.
3. **Must-haves (Phase 3 — Agent)** — `ai_provider_settings`,
   `ai_conversations`, `ai_messages`, `ai_tool_calls`, `ai_usage_logs` +
   the provider abstraction + the tool registry + `/agent` UI.
4. **Must-haves (Phase 4 — Approvals)** — `ai_approvals`,
   `ai_execution_logs` + the executor + `/approvals` UI.
5. **Should-haves (Phase 5 — Finance & analytics)** — `/finance`,
   `/analytics`, the report endpoints.
6. **Should-haves (Phase 6 — Ads & shipping)** — `advertising_accounts` +
   the connector interface + the honest disconnected states; the shipping
   view built on the existing reconciliation/collections data.
7. **Should-haves (Phase 7 — Reports & connections)** — `scheduled_reports`,
   `report_deliveries`, `external_api_tokens`, the read-only API and the MCP
   endpoint.
8. **UI transformation (Phase 8)** — navigation, the new home, the mobile
   dock, dark mode.
9. **Verification (Phase 9)** — unit tests, API tests, Playwright at ten
   widths, permission checks, and the status table in the deliverables.

**The three riskiest parts:** (1) profit honesty when the cost data is
missing, (2) tool-calling with per-role data access, (3) an approval →
execution path that cannot run twice and cannot exceed the approver's
permissions.

**Next:** `/replica-design` — measure the target's own tokens (El Nour keeps
its emerald identity; the role names and the scale are what get adopted).
