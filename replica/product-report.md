# Product report — El Nour Business OS

**Date** — 2026-11-21 · **Scope** — the transformation from an operations
dashboard into an AI-native business operating system (Phases 0–15 + §22/§23
of the master prompt) · **Basis** — the live app, the live database, 449 unit
tests, 33 Playwright checks, and `replica/diff.md`.

---

## 1. What the product is now

A single Arabic-first (RTL) business operating system for one Egyptian
e-commerce store, built on four rules that are enforced in code, not in a
style guide:

1. **Math before AI** — every number is computed by a pure, tested engine
   (`src/lib/metrics`, `src/lib/analytics`, `src/lib/overview`,
   `src/lib/decisions`, `src/lib/intelligence`). The AI layer may phrase a
   result; it may never introduce a number that is not in the evidence.
2. **Profit is withheld** — while a cost, an expense, an ad spend or a
   collection is missing, the product shows `—` plus the reason and the exact
   screen where the owner can fix it. It never shows sales minus nothing.
3. **No fake certainty** — every metric carries a status (`actual`,
   `estimated`, `incomplete`, `unavailable`, `not_applicable`), a formula, the
   source tables, the window and the last update.
4. **Approval before action** — an AI may propose; only the owner executes,
   and only after the permissions and the idempotency key are re-checked.

## 2. The screens (S01–S22)

| # | screen | route | what the owner gets |
|---|--------|-------|---------------------|
| S01 | Executive home | `/dashboard` | today's business on one screen: revenue, orders, average order value, profit (or why it is withheld), the decisions strip, the trend |
| S02 | Business knowledge | `/brain` | the brain status, the learning state, the gaps |
| S03 | Business profile | `/settings` | name, website, industry, market, currency, timezone |
| S04 | Goals | — | measurable goals (**written, not applied** — see Gap 1) |
| S05 | Business rules | — | rules in natural language (**written, not applied**) |
| S06 | Knowledge sources | — | documents + verification date + confidence (**written, not applied**) |
| S07 | The assistant | `/agent` | a deterministic agent that answers from the real engines, with the calculation and the sources attached |
| S08 | Approvals | `/approvals` | proposed changes, the impact, the risk level, reversible or not |
| S09 | Decisions | `/decisions` | what needs the owner's attention, each with the numbers that triggered it |
| S10 | Revenue & profit trends | `/dashboard` | sales daily; the profit line appears only when it is computable |
| S11 | Scheduled reports | `/reports` | on-demand + daily snapshots (**no delivery channel yet**) |
| S12 | Financial report | `/reports` | the income statement, the cash flow, the unit economics |
| S13 | Product economics | `/analytics` | revenue, cost, margin per product |
| S14 | Customer analytics | `/analytics` | sales/product/operations analytics (customer deep-dive pending) |
| S15 | Operations analytics | `/analytics` | orders, fulfilment, backlog, ageing |
| S16 | Ads & attribution | `/marketing` | the connector contract; **no live ads platform** → honestly "غير متاح" |
| S17 | **Business Overview** | `/overview` | the cockpit: net profit · delivered ROAS · profit per order · RTO exposure · missing cash · delivery rate — each with its status, the breakdown, the health verdict and the biggest risk |
| S18 | Risk | `/risk` | COD risk per order with the evidence; a **verification** action, never an automatic rejection |
| S19 | Anomalies | `/anomalies` | the baseline next to the actual value, with the probability and the likely causes |
| S20 | Forecast | `/forecast` | a statistical baseline with the measured MAPE, the confidence band and the assumptions |
| S21 | Simulator | `/simulator` | nine levers, break-even, max CAC; **read-only**, and the profit stays withheld when its inputs are missing |
| S22 | Briefing | `/briefing` | the daily briefing: real numbers, the risks, proposed tasks, and what it could **not** say |

Plus `/setup/costs` — the screen that unblocks the profit.

## 3. The state of the business, honestly

| fact | value | source |
|------|-------|--------|
| orders | 2,023 total · 742 in the last 30 days | `orders` |
| open value | 755,232 ج.م | `orders` |
| older than 30 days | 1,257 orders · 431,787 ج.م | `orders` |
| delivery rate | 0% — not one order is marked delivered | `orders.status` |
| payment state | every order is `pending` | `orders.payment_status` |
| shipping fee collected | 59.85 ج.م per order vs. a 30 ج.م setting | `orders.shipping_fee` vs `business_settings` |
| product costs | 12 products with `cost_price = 0` | `products` |
| expenses · collections · reconciliation | none recorded | `expenses` · `collection_batches` · `daily_reconciliations` |

The product does not hide any of this. It shows it as the top risk, and it
refuses to compute a profit from it.

## 4. The honest verdict

**The system works and the business data does not yet.**

What is finished: the engines, the honesty layer, the screens, the agent, the
approval path, the API/MCP surface, the tests. What is missing is **data and
access**, not code:

- the three additive migrations are not applied to production (owner action);
- the real costs, expenses and collections are not entered (owner session);
- no AI provider is configured (the deterministic path still answers);
- no ads account and no report delivery channel (external accounts).

The product is honest about all four, and the product is ready the moment
they are resolved — `/setup/costs` opens the profit gate by itself.

## 5. What the owner should do next

1. Apply the three migrations (SQL Editor → `supabase/pending-migrations.sql`).
2. Open `/setup/costs` and enter the purchase cost of the 12 products.
3. Register the daily reconciliation and the collection batches — these are
   the inputs the cash panel is waiting for.
4. Ask the assistant the first real question ("ليه المبيعات زادت والربح نزل؟")
   and read the answer's sources.
