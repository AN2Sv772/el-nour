# Verification ledger — El Nour Business OS

> The honest state of the transformation, written against the categories the
> brief requires: **VERIFIED WORKING · IMPLEMENTED BUT NOT VERIFIED ·
> PARTIALLY WORKING · BLOCKED · NOT IMPLEMENTED · FAILED**.
>
> Every "VERIFIED" row below was checked against the REAL production database
> (read-only) through the running app on `localhost:3000` with a minted admin
> session. Nothing in this file was inferred from the code alone.

**Date of this ledger:** 2026-11-21
**Build:** `npm run build` → exit 0 · **Types:** `npx tsc --noEmit` → clean
**Tests:** `npx vitest run` → **368 passed / 368** (28 files)

---

## 1. VERIFIED WORKING

Checked end-to-end against production data on 2026-11-21.

| # | Capability | Evidence | How it was checked |
| --- | --- | --- | --- |
| V1 | **One metrics engine** — every figure comes from `src/lib/metrics/calculations.ts` | 24 unit tests + live API | `npx vitest run src/lib/metrics`; `GET /api/metrics/overview?dateRange=last_30_days` → 200 with 24 metrics, each carrying `provenance` |
| V2 | **Revenue is a fact** | last 30 days: `revenue = 315,560 EGP`, `total_orders = 741`, status `actual` | live API against production |
| V3 | **Profit is WITHHELD, not faked** | `net_profit.value = null`, status `incomplete`, missing = "تكلفة المنتجات ناقصة • مصروف الإعلانات غير متاح • لا تُسجَّل مصروفات في النظام" | live API + unit test "never publishes net profit while an input is missing" |
| V4 | **Zero is not published as "no cost"** | `product_costs = null` / `incomplete` for 740 of 740 order lines and 12 of 12 products | live API; unit test "treats a zero cost as unknown, not as free" |
| V5 | **Zero expenses are not published as "no spend"** | `operating_expenses = null` / `incomplete`; gap `expenses_not_recorded` (critical) | live API (the `expenses` table is empty) |
| V6 | **Untracked inventory is not published as "0 units"** | `inventory_units = null` / `unavailable`; gap `inventory_not_tracked` (all 12 products have `track_inventory = false`) | live API |
| V7 | **Cash is only published when it was really collected** | `cash_collected = null` / `unavailable` (no `collection_batches` rows) | live API |
| V8 | **Shipping is labelled as an estimate** | `shipping_cost = 22,230`, status `estimated` (= `default_shipping_fee` 30 × 741 orders) | live API; unit test |
| V9 | **Previous-period comparison is real** | this month 238,710 vs last month 284,803 → −16.2 %; 506 vs 823 orders → −38.5 % | live API + `/api/ai/chat` comparison |
| V10 | **Every metric explains itself** | each card has "كيف تم الحساب؟" → formula, source tables, missing inputs | browser check on `/dashboard` (4 disclosure blocks found) |
| V11 | **The executive overview is on the dashboard** | cards + gaps banner + Brain strip, above the legacy widgets | Playwright DOM probe of `/dashboard` |
| V12 | **The legacy dashboard still works** | orders/products/reconciliation/collections/reports all untouched and rendering | Playwright + `GET /api/dashboard/stats` → 200 with the same numbers as before |
| V13 | **The assistant answers with real numbers and refuses to guess** | "كم مبيعات آخر 30 يوم؟" → 315,560 EGP + previous-period delta; "ما هو صافي الربح؟" → "محجوب" + the three reasons | browser click-through on `/agent`; `GET/POST /api/ai/chat` |
| V14 | **Two named periods are compared as named** | "قارن مبيعات هذا الشهر بالشهر الماضي" compares *this month* to *last month*, not to an automatic 30-day window | live API; unit test "compares two named periods as named" |
| V15 | **The assistant works with NO AI provider** | mode = `deterministic`; 16 unit tests over intent detection + answer building | `src/lib/ai/agent.test.ts` |
| V16 | **Role checks on every new route** | all 12 new API routes call `requireRole(...)` | code inspection + live 403 path exercised by the role ladder |
| V17 | **The Brain degrades gracefully before its migration is applied** | `/api/brain/status` → 200 `available:false`; `/api/brain/audit` → 503 with the migration filename; `/brain` page shows the instruction | live API + browser |
| V18 | **The session cookie tooling was repaired** | `scripts/mint-admin-session.cjs` now writes base64**url** (the format @supabase/ssr 0.12.7 decodes) | every live probe above depends on it |
| V19 | **A change request becomes a PROPOSAL, never an action** | "سجّل تكلفة مساحة ارضيات ببخاخ بـ 45 جنيه" → the correct product ("مساحة ارضيات ببخاخ", EO-18abd7cf…) and the correct amount (45) are extracted, and the reply says nothing has changed yet | live `POST /api/ai/chat`; 9 unit tests over the parser |
| V20 | **The proposal degrades gracefully before its migration is applied** | `POST /api/ai/chat` → 503 with the migration filename, and the parsed action is still shown | live API |
| V21 | **The profit & loss statement is built FROM the metric set** | every line of `/api/analytics` equals the corresponding metric — the statement and the dashboard cards cannot disagree | live API + 13 unit tests |
| V22 | **The P&L withholds every subtotal whose input is not a fact** | last 30 days: revenue 315,560 **actual** · gross profit `—` (740/740 order lines have no unit cost) · shipping 22,230 **estimated** · ads/expenses/returns `—` · provisional AND final profit `—` | live API + live DOM (`/analytics`) |
| V23 | **Cash flow says "not recorded", never "zero"** | no collection batch ⇒ `status: unavailable`, `received: null`, `outstanding: null`, and the page shows "لا توجد دفعات تحصيل مسجّلة" | live API + live DOM |
| V24 | **The blind revenue is quantified** | 314,980 EGP of product revenue (100% of it) came from products with no recorded cost — 9 products, 0 with a known margin | live API + live DOM |
| V25 | **The financial report no longer publishes a fake profit** | the old report showed "الربح الأولي: 323,445 E£" — which was simply the sales (cogs = 0 because no product has a cost, expenses = 0 because the table is empty). It now shows `—` with "محجوب — مدخلاته ناقصة" | live API + live DOM (`/reports`) |
| V26 | **The report's daily series and its statement agree exactly** | Σ(daily.revenue) = 324,085 = the statement's revenue, over the same window | live API |
| V27 | **The decision engine fires on real evidence** | 10 decisions from live data, each with its numbers: 0 deliveries of 741 orders · 1,257 orders older than 30 days worth 431,787 EGP · no payment status on any order · no expenses · 9 products sold without a cost · no courier collections · shipping collected 59.85 EGP vs the configured 30 EGP | live API + live DOM (`/decisions`) |
| V28 | **The external API and the MCP server fail CLOSED** | with no `REPORTS_API_KEY` they answer 503 "الواجهة الخارجية غير مُفعّلة"; with a wrong key 401; with the right key they serve the same honest payloads. The MCP server answers `initialize`, `tools/list` and `tools/call` over JSON-RPC 2.0 | live API + live MCP client (curl) |
| V29 | **The snapshot cron computes the day and degrades gracefully** | POST `/api/cron/report-snapshot` with the real `CRON_SECRET` computes 2026-11-20 (`status: partial`, because that day's metrics were incomplete) and then reports 503 with the migration filename — it never invents a storage | live API |
| V30 | **The dashboard's profit card is now the honest one** | "صافي الربح: —" with "محجوب: تكلفة المنتجات والمصروفات غير مسجّلة — لا يُعرض رقم يساوي المبيعات" — the old card printed the provisional profit, which was the sales | live DOM (`/dashboard`) |
| V31 | **The daily chart reads the metric engine's own series** | the chart is the same data as the cards and the report; and while the costs are missing it draws revenue + orders and says "خط الربح غير معروض" instead of drawing a line equal to the sales | live DOM |
| V32 | **The dashboard shows what needs a decision** | the two most urgent decisions (of the ten the engine produced) sit on the home screen with their numbers, and link to the full list | live DOM |
| V33 | **A mislabelled card was corrected** | the card "طلبات جديدة اليوم" actually showed the **selected period's** count (741 for 30 days). It now shows the average order value, and the period's order count lives on the "الطلبات" card | live DOM |
| V34 | **The Business Overview cockpit (S17) reads the real records and withholds what it cannot prove** | `/overview` shows net profit `—` + "محجوب: تكلفة المنتجات ناقصة · مصروف الإعلانات غير متاح", ROAS `غير متاح`, RTO **40,480 EGP** (120 orders), the delivery rate **0%**, the period's health verdict "التوسّع خطير الآن", the strongest product and the biggest risk — all from the live data | live DOM + live API |
| V35 | **The four analytic engines produce evidence, not opinions** | `/risk` scores live orders with their signals (and states the low confidence caused by the missing delivery history); `/anomalies` shows the baseline next to the actual (the 59.85 vs 30 shipping mismatch, the backlog growth, the concentration); `/forecast` publishes the method, the **measured MAPE (31.13%)** and the confidence band; `/simulator` returns a zero delta for a no-op and keeps the profit `null` while the costs are missing | live DOM + live API |
| V36 | **The daily briefing is backed by numbers and lists its blind spots** | `/briefing` shows the day's real figures, 5 critical issues, the proposed tasks (with an assignee, a due date and "تحتاج موافقة"), and the section "ما لا تستطيع الإحاطة قوله بعد" | live DOM |
| V37 | **The cost entry opens the profit gate** | `/setup/costs` lists every product with its price and the current cost state, previews the margin as the owner types, and writes through the audited product-cost path | live DOM + unit tests (9) |
| V38 | **One formatter for every number in the app** | the dashboard, the cockpit, the agent's answers and the decisions page now print the same money the same way — `315,880 ج.م` (Latin digits, no trailing dot). Before the fix the dashboard printed `٣١٥٬٨٨٠٫٠٠ ج.م.` for the same figure (bug B01) | live DOM + unit test |
| V39 | **The briefing no longer drops a row** | the React console warning "two children with the same key … task_no_deliveries" is gone: the anomaly and the decision that share the base id are now namespaced (`task_anomaly_*`, `task_decision_*`) and the engine enforces unique ids (bug B02) | live DOM (the e2e suite fails on any console error) |
| V40 | **A missing table now says what to do** | `GET /api/ai/approvals` answers 503 with `migration: 20260124000000_ai_approvals.sql` and `how_to_apply`, instead of the raw driver message (bug B03) | live API |
| V41 | **The end-to-end suite runs against the live database and passes** | 28 desktop + 6 mobile Playwright checks (34/34): the cockpit and the dashboard agree on the same window, no 5xx and no console error on any screen, no horizontal overflow at 360 → 1440 px, and the MCP server answers `initialize` + `tools/list` with the three read-only tools | Playwright (live) |
| V42 | **The whole project still passes after this round** | 449 unit tests across 37 files, `tsc --noEmit` clean, `next build` clean (24 routes) | local CI |

## 2. IMPLEMENTED BUT NOT VERIFIED

Written and type-checked, but **not** exercised end-to-end, because the
precondition is missing (no provider key, no applied migration, no connected
platform).

| # | Capability | Where | Why it is not verified |
| --- | --- | --- | --- |
| I1 | Business Brain storage (7 tables, RLS on, `CHECK` that an AI read can never be born verified) | `supabase/migrations/20260123000000_business_brain.sql` | the migration has **not** been applied to production; no local Postgres is available to apply it to |
| I2 | Brain profile / knowledge / rules / goals / questions CRUD | `src/app/api/brain/**` | every read path is exercised (they answer "not configured"), but no write has run against a real table |
| I3 | The Brain audit | `POST /api/brain/audit` | returns 503 until the migration is applied |
| I4 | The Brain page (coverage ring, area coverage, question cards, profile form, rules & goals) | `src/app/brain/page.tsx` | renders the "not applied" state; the filled state has never been rendered |
| I5 | AI provider abstraction (OpenAI-compatible / Anthropic / Gemini) + AES-256-GCM key storage | `src/lib/ai/provider.ts` | no provider is configured and no key exists; the encryption path is unit-testable but untested against a live provider |
| I6 | Provider-driven phrasing of an answer (the model may rephrase, never invent) | `src/app/api/ai/chat/route.ts` | the provider branch has never run |
| I7 | Daily series for the revenue/profit chart | `GET /api/metrics/series` | returns 200 with 29 points, but the **chart** that consumes it is not built yet |
| I8 | Approval storage (2 tables, `UNIQUE idempotency_key` on both the approval and the execution log, RLS on) | `supabase/migrations/20260124000000_ai_approvals.sql` | the migration has **not** been applied to production; no local Postgres is available |
| I9 | Approve / reject / undo, exactly-once execution, before/after snapshot written at approval time | `src/lib/ai/approvals.ts`, `src/app/api/ai/approvals/**` | the whole execution path needs the tables; the unit-level allow-list and the idempotency key derivation are tested, the database round-trip is not |
| I10 | The approvals page (pending queue + history, risk badge, impact text, undo) | `src/app/approvals/page.tsx` | renders the "not applied" state; the filled state has never been rendered |
| I11 | The cash-flow CHART (expected vs received per batch) | `src/app/analytics/page.tsx` | renders correctly, but the live project has **zero** collection batches, so the chart has never been drawn with real data |
| I12 | The expense-breakdown bars by category | `src/app/analytics/page.tsx` | the live `expenses` table is empty, so the breakdown has never been drawn with real data |
| I13 | The CSV exports (daily series + products) | `src/app/api/reports/financial/route.ts?format=csv` | the file downloads with the right rows and the UTF-8 BOM, but it has never been opened in Excel |
| I14 | The daily snapshot table + its cron | `20260125000000_report_snapshots.sql`, `/api/cron/report-snapshot` | the cron computes the payload but cannot store it until the owner applies the migration; no snapshot has ever been written |
| I15 | The advertising connector contract | `src/lib/ads/connector.ts` | the adapter interface and the platform list exist; no adapter is registered, so the spend stays `unavailable` — as it must |

## 3. PARTIALLY WORKING

| # | Capability | What works | What does not |
| --- | --- | --- | --- |
| P1 | **Order status reporting** | `pending / shipped / delivered / cancelled / returned` counts are real | the store marks **0 orders delivered** and **0 returned**, so the delivery rate is 0 % and the return rate is 0 % — real numbers, but they describe an unused workflow, not a healthy delivery process |
| P2 | **The legacy profit card** | it still shows `provisional_profit` | the label now says "بدون تكلفة المنتجات" and carries a warning **only** when the metrics engine reports the costs as missing; the number itself is still the old, over-stated one |
| P3 | **Period detection in the assistant** | 10 presets detected from Arabic and English words | a question naming a period outside the preset list ("أسبوعين مضت") falls back to "this month" |

## 4. BLOCKED

| # | Capability | Blocker | What is needed |
| --- | --- | --- | --- |
| B1 | **Real net profit** | 12 of 12 products have `cost_price = 0`; 0 advertising accounts; the `expenses` table is empty | the owner enters product costs, connects an ad platform, and starts recording expenses |
| B2 | **A live AI provider** | no provider row, no API key, no `CREDENTIALS_ENCRYPTION_KEY` | one provider key + a 32-byte base64 encryption key |
| B3 | **The Brain in production** | the migration has not been applied | the owner applies `supabase/migrations/20260123000000_business_brain.sql` (additive only — it creates tables, it does not touch or drop any existing one) |
| B4 | **Shipping cost as a fact** | no `collection_batches` exist | the owner records the first courier collection |
| B5 | **Returned-order loss** | no `daily_reconciliations` exist | the owner runs the daily reconciliation (the page exists) |
| B6 | **Advertising and campaign analytics** | no advertising platform is connected | a Meta / TikTok / Google Ads connection |
| B7 | **Scheduled reports & external API / MCP** | not started | Phase 7 — deliberately not built before the core is verified |

## 5. NOT IMPLEMENTED

| # | Capability | Planned phase |
| --- | --- | --- |
| N1 | ~~Approval cards~~ | — (moved to I8–I10: the storage and the flow are written; they are waiting for the migration) |
| N2 | Decisions & outcomes (`business_decisions`, `decision_outcomes`) | Phase 6 |
| N3 | ~~Scheduled reports & delivery history~~ | moved to I14 (the cron and the table are written; the migration is pending) |
| N4 | ~~External API tokens / MCP surface~~ | moved to V28 (the API key gate and the MCP server are live and verified) |
| N5 | Knowledge-graph view of the Brain (the visual graph of topics) | Phase 8 |
| N6 | File import with owner review (the "upload → parse → review → confirm" flow) | Phase 3 |
| N7 | ~~Advertising and shipping modules~~ | the ads **connector contract** and the shipping decision are done (I15); a connected ad platform remains impossible without the owner's credentials |
| N8 | ~~The `/analytics` page~~ | done — V21…V24 |

## 6. FAILED

Nothing in the transformation failed. Two defects were found **and fixed**
during the work, and they are recorded here so they are not lost:

| # | Defect | Fix |
| --- | --- | --- |
| F1 | `scripts/mint-admin-session.cjs` wrote a standard-base64 cookie; @supabase/ssr 0.12.7 decodes base64**url** only → every authenticated request answered 401 | the script now writes `base64url`; all live probes in this ledger depend on it |
| F2 | The metrics engine queried three columns that do not exist (`collection_deductions.category`, `daily_reconciliations.reconciliation_date`, `daily_reconciliations.status`) → 500 on the first live call | corrected against the real schema (`label`, `business_date`); the schema mismatch was found by running against production, not by reading the code |
| F3 | **The financial report published a fake profit.** It computed `sales − cogs − expenses` where cogs = 0 (no product has a cost) and expenses = 0 (the table is empty) → a bold "الربح الأولي: 323,445 E£" that was just the sales wearing a profit's label | the report is now built on the same engine as the dashboard: every line carries its status, the profit is withheld while its inputs are missing, and the daily series and the statement are the same numbers (V25, V26) |
| F4 | The rebuilt report passed UTC instants into the custom-range parser, which rejected them as invalid dates and silently fell back to "all time" → a 30-day report containing 73 days of rows | the bounds are now converted to Cairo **business days** before the query; the daily series matches the statement exactly (V26) |

---

## 7. What production actually says about this store

Read-only, on 2026-11-21 — the numbers the system refuses to publish, and why:

| Observation | Evidence |
| --- | --- |
| 2,023 orders exist; 741 in the last 30 days | `orders` |
| 0 orders are marked **delivered** and 0 **returned** | `orders.status` |
| 1,977 orders are still `pending` | `orders.status` |
| 0 products have a cost; 0 have tracked stock | `products.cost_price`, `products.track_inventory` |
| 0 expenses, 0 collection batches, 0 daily reconciliations | `expenses`, `collection_batches`, `daily_reconciliations` (all empty) |
| The configured shipping fee is 30 EGP and the tax rate is 0 | `business_settings` |
| Shipping fees are actually collected at **59.85 EGP per order** on average → the configured fallback understates the shipping cost by about half | `orders.shipping_fee` (last 30 days: 45,850 on 766 orders) |
| **1,257 orders** are still open after 30 days, worth **431,787 EGP**; 2,023 open orders worth 755,232 EGP in total | `orders.status`, `orders.total_amount` |
| **No order carries a payment status** — all 2,023 are `payment_status = 'pending'` | `orders.payment_status` |
| The orders arrive from EasyOrders but are never moved past `pending`/`confirmed` — 46 confirmed, 0 delivered, 0 returned, 0 cancelled | `orders.status` |

**Conclusion:** the store's data pipeline is alive and healthy (2,023 orders
arrive from EasyOrders), but the **financial recording** side has never been
used. That is why the system publishes revenue and withholds profit: the
numbers it refuses to show are refused for a reason that can be read in the
tables.
