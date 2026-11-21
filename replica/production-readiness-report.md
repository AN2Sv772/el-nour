# Production-readiness report — El Nour Business OS

**Date** — 2026-11-21 · **Target** — `https://el-nour-dashboard.vercel.app`
(Vercel Hobby, project `el-nour-dashboard` linked) · **Database** — Supabase
`lyswmlmrlviptprhfiph`.

> **No deployment was performed in this session.** The master prompt's §22
> forbids an automatic deploy. This report states exactly what would happen if
> the owner approves one, and what is still missing before it.

---

## 1. Readiness scorecard

| area | state | evidence |
|------|-------|----------|
| the production build | **ready** | `npm run build` → clean, 24 routes |
| types | **ready** | `tsc --noEmit` → clean |
| the test suite | **ready** | 449 unit + 33 e2e, all green |
| the production environment | **ready** | `REPORTS_API_KEY` (secret, production), `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET` are set; the Supabase and EasyOrders variables are already in use |
| the Vercel link | **ready** | the CLI is authenticated (`an2sq100-1199`) and the project is linked |
| the database migrations | **BLOCKED** | the three additive migrations are not applied; this machine cannot apply them (Supabase CLI 403, no `psql`, no Management token) |
| the AI provider | **not configured** | the deterministic path serves every request; the provider branch is dormant by design |
| the ads connector | **not configured** | no Meta/TikTok/Google credential; ROAS is honestly "غير متاح" |
| the report delivery channel | **not built** | on-demand + daily snapshots only |
| the data inputs (costs, expenses, collections, reconciliation) | **empty** | the product withholds the affected numbers and says why |

## 2. What a deploy would do

A production deploy is additive and low-risk:

1. the new routes ship — `/overview`, `/briefing`, `/risk`, `/anomalies`,
   `/forecast`, `/simulator`, `/setup/costs`, and the new APIs;
2. the shared formatter changes the money strings across the app from
   `٣١٥٬٨٨٠٫٠٠ ج.م.` to `315,880 ج.م` (a visible, intentional change);
3. no schema change, no destructive migration, no data write;
4. the existing sessions, the existing EasyOrders sync and the existing RLS
   are untouched.

**Risk of the deploy itself: low.** The risk of the *product without the
migrations* is also low, because the three affected routes fail closed with
a 503 that names the migration file.

## 3. The three migrations that must be applied first

| file | creates | what it unlocks | what happens without it |
|------|---------|-----------------|--------------------------|
| `20260123000000_business_brain.sql` | `business_brain`, `business_knowledge_sources`, `business_goals`, `business_rules` | the knowledge layer, the goals, the rules in natural language | `/api/brain/audit` → 503; the brain status shows the gap |
| `20260124000000_ai_approvals.sql` | `ai_approvals` | the whole approval pipeline (propose → approve → execute → audit) | `/api/ai/approvals` → 503 with the migration name; the agent cannot propose |
| `20260125000000_report_snapshots.sql` | `report_snapshots` | the scheduled daily report history | `/api/cron/report-snapshot` → 503 |

**How to apply (owner action, one minute):**

- **Option A** — Supabase → SQL Editor → paste `supabase/pending-migrations.sql`
  → Run. (The file contains the three migrations, additive only, 664 lines.)
- **Option B** — create a Supabase Management access token, then:
  ```bash
  SUPABASE_ACCESS_TOKEN=… node scripts/apply-migrations.mjs
  ```
  (the script supports the Management API, the Supabase CLI and a `--print`
  mode that prints the SQL without touching anything).

**After applying:** restart the cron (`vercel cron` picks up the schedule) and
re-check `/approvals`, `/brain` and `/reports`.

## 4. The rollout checklist

| # | step | owner | state |
|---|------|-------|-------|
| 1 | apply the three migrations | owner | **pending** |
| 2 | deploy (one explicit approval) | owner | **ready — waiting for the approval** |
| 3 | open `/setup/costs` and enter the 12 product costs | owner + assistant | **pending** — this is what makes the profit appear |
| 4 | diagnose the EasyOrders status sync (0 delivered / 46 confirmed) | owner | **pending** — the biggest data risk |
| 5 | decide the shipping-fee truth (59.85 collected vs. 30 configured) | owner | **pending** |
| 6 | start recording the collection batches and the daily reconciliation | owner | **pending** |
| 7 | choose an AI provider and set its key (optional) | owner | **optional** |
| 8 | connect the ads platform (optional) | owner | **optional** |
| 9 | hand over `REPORTS_API_KEY` to the owner | assistant | **pending** |

## 5. What is explicitly NOT done, and why

| not done | reason |
|----------|--------|
| no deploy | §22 of the master prompt — "do not deploy automatically" |
| no production data write | no destructive or irreversible change without the owner's explicit approval |
| no RLS change, no policy weakening | the security rules are a hard constraint |
| no fake data to fill a gap | a mocked cost or a mocked expense would make the whole product lie |
| no secret written into the repository | the API key stays in the Vercel environment and in a temporary file outside the project |

## 6. The readiness verdict

**Technically ready to deploy; operationally waiting on two owner actions.**

The code is tested, the build is clean, the environment is configured, and the
deploy itself is additive. What is missing is not engineering:

1. **three SQL statements** the owner can run in a minute; and
2. **the real numbers** — the costs, the expenses, the collections — which
   only the owner can supply.

Once both are done, the product's central promise becomes true end-to-end:
the profit stops being withheld, because the data that justifies it exists.
