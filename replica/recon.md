# Recon map: Analify AI (web) → transformation map for El Nour Dashboard

Scope: the business-intelligence core of Analify — Business Brain, the AI agent
("Aziz"), the executive Home, Finance, Dashboards, Reports and AI Connections.
Not: Agency (multi-brand portfolio), their payment/AI-credit plans, their
partner network, their own brand assets.

For: El Nour — a single-store Egyptian ecommerce business (EasyOrders +
Supabase + Vercel), Arabic-first, owner-operated.
Date: 2026-11-20

> **This is a transformation map, not a copy plan.** El Nour keeps its own data
> model, its own brand (emerald), its own RTL layout and its own accounting
> rules. What is taken from Analify is the **product architecture and the
> behavioural patterns** — what a metric shows, when a number is withheld, how
> an action is approved, how knowledge is sourced.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Analify docs — Business Brain | https://analify-ai.readme.io/docs/business-brain | training, topics, operating contract, sources & evidence, honest gaps, decision history |
| 2 | Analify docs — Aziz (the agent) | https://analify-ai.readme.io/docs/analify-agent | answer anatomy, approval cards, honest verdicts, "Math before AI", model/tool switches |
| 3 | Analify docs — Getting started | https://analify-ai.readme.io/docs/getting-started | the 8 products, Blended Profit definition, the 9-step setup guide, "Soon" badges |
| 4 | Analify live demo (public, no signup) | https://analify.scalyax.ai/demo/home | the real Home / Brain / Finance / Chat screens — measured, not guessed |
| 5 | Analify docs — developers | https://analify-ai.readme.io/docs/quickstart , /concepts , /recipes , /mcp | the API + MCP surface an external AI client can use |
| 6 | El Nour source | this repository | 33 API route files, 12 page groups, 45+ tables, 4 roles |
| 7 | El Nour production | https://el-nour-dashboard.vercel.app | read-only comparison against the source |
| 8 | replica-skill | https://github.com/Jakeschincariol/replica-skill | the recon→architect→design→build→backend→test→diff workflow used for this map |

## Core loop

**Ask the business a question → get an answer built from the store's own
records, with the calculation and the sources shown → approve the change it
proposes → see what happened afterwards.**

Analify's loop is: *know the business (Brain) → ask (Agent) → check the
evidence → approve the action → track the result → keep the knowledge current.*

El Nour already has the last loop's *business* half (orders → reconciliation →
collections → profit). What is missing is the first half: the knowledge, the
question answering, the evidence and the approval.

## Screens

| ID | screen (Analify) | route in the demo | El Nour target | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Home | `/demo/home` | `/` (new executive home) | one place for today's numbers, what needs attention, and the ask box | Brain coverage row, ask box, announcements, getting-started steps, top creatives, jump-to, report status | filled, "needs you", "nothing needs attention" |
| S02 | Business Brain → Overview | `/demo/brain` | `/brain` (new) | what the system knows, what is missing, who answered what | Brain status region, coverage sphere, source chips, tabs, business audit list | needs-you, learning, ready, outdated |
| S03 | Business Brain → Business Profile | `/demo/brain/profile` | `/brain/profile` (new) | the business's own description | form | empty, filled |
| S04 | Business Brain → Knowledge Graph | `/demo/brain/knowledge` | `/brain/knowledge` (new) | topics, sources and the links between them | graph, guessed links | guessed, confirmed |
| S05 | Business Brain → Questions for you | (tab on S02) | `/brain/questions` (new) | the questions only the owner can answer | question cards, answer form, skip | open, answered, skipped |
| S06 | Assets Library | `/demo/assets-library` | `/brain/assets` (new) | files, uploads, open questions | file list, filters, review drawer | empty, review-pending, accepted, rejected |
| S07 | Aziz chat | `/demo/chat` | `/agent` (new) | ask about the whole business | message log, reasoning toggle, answer card with the calculation breakdown, follow-ups, approval card | streaming, answered, partly, withheld, failed |
| S08 | Business Dashboards | `/demo/business-overview` | `/analytics` (new) | sales / product / customer / operations analytics | metric cards, charts, tables | filled, empty, missing-data |
| S09 | Finance | `/demo/finance` | `/finance` (new) | income, expenses, cash, recorded net | 3 summary cards with breakdowns, entries table, month view, filters | filled, empty |
| S10 | Ads | `/demo/analytics/ads` | `/marketing` (new) | advertising performance and profitability | campaign table, spend/ROAS charts, profitability split | disconnected, partial, filled |
| S11 | Reports | `/demo/analytics/reports` | `/reports` (existing → extended) | scheduled business updates | schedule list, delivery history, create form | empty, scheduled, failed |
| S12 | Settings → Integrations | `/demo/settings/integrations` | `/settings/integrations` (existing → extended) | what is connected | connection cards, health, credentials | connected, disconnected, error |
| S13 | Settings → MCP / AI Connections | `/demo/settings/mcp` | `/settings/connections` (new) | let external AI clients read the business | token list, scope picker, revoke | active, revoked, expired |

## Flows

```
F01 Owner asks a business question
    S01 ask box -> S07 chat -> answer card (calculation breakdown + sources)
    happy path clicks: 2
    edge: no LLM provider configured → "insufficient data / provider not configured"
          question needs product costs → profit withheld, reason shown
          question needs a courier → cash split unavailable, reason shown

F02 Owner teaches the business something
    S02 -> S05 answer question -> S02 coverage % increases
    happy path clicks: 3
    edge: AI proposed an answer that contradicts a record → conflict shown, owner resolves

F03 Owner reviews a file before it enters the Brain
    S06 upload -> review summary -> accept or reject
    happy path clicks: 4
    edge: file unreadable → rejected with the reason, nothing saved

F04 AI prepares a change, owner approves it
    S07 answer -> approval card (what changes, why, severity, reversible?) -> Allow
      -> execution (idempotent, re-checked permissions) -> verified result -> audit row
    happy path clicks: 3
    edge: owner clicks Allow twice → second click refused, action runs once
          permissions changed since preparation → execution refused with the reason
          execution failed → "Action failed" + error, nothing half-applied

F05 Owner checks today's business
    S01 -> metric cards (each with status, calculation, source, range, last update)
      -> compare with the previous period -> drill into the module
    happy path clicks: 1
    edge: cost data missing → the card shows "غير مكتمل" instead of a profit number

F06 Owner reads a scheduled report
    S11 schedule list -> delivery history -> the delivered document
    happy path clicks: 2
    edge: provider refused → delivery marked failed, never "sent"

F07 External AI client reads the business
    S13 create a scoped token -> MCP / read-only API -> revoke
    happy path clicks: 3
    edge: token revoked → 401 immediately; write scope absent → the write tool is absent
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Metric card | currency, count, percent | actual, estimated, incomplete, unavailable, loading, error | S01, S08, S09 |
| Coverage meter | ring, bar | learning, partial, complete | S01, S02 |
| Source chip | live, stale, disconnected | hover detail | S02, S12 |
| Question card | open, answered, skipped | answering, saved | S05, S02 |
| Answer card | answered, partly, withheld, failed | streaming, stopped, regenerate | S07 |
| Approval card | notification, change, stops-now, hard-to-undo | draft, pending, approved, rejected, running, done, failed, expired | S07, S10 |
| Breakdown list | formula lines | expandable | S07, S09 |
| Comparison chip | up, down, flat | no previous period | S01, S08, S09 |
| Data-gap banner | info, warning, critical | dismissible | S01, S08, S09 |
| Connection card | connected, disconnected, error | connecting, last synced | S12, S10 |
| Schedule card | daily, weekly, monthly | active, paused, failed | S11 |
| Chat composer | text, attachments, tools | sending, stopped, disabled | S07, S01 |

## Inferred data model (and where El Nour already has it)

```
BusinessProfile          name, website, description, industry, market, currency,
                         timezone, goals, channels, connected platforms
                         evidence: S03, S12        confidence: high
                         → El Nour has `business_settings` (singleton) — extend it,
                           do NOT create a duplicate table.

KnowledgeItem            topic, title, body, source_kind, source_ref, created_at,
                         last_verified_at, confidence, status, confirmed_by, version
                         evidence: S02, S06        confidence: high
                         → NEW table `business_knowledge` (+ `business_knowledge_sources`).

BusinessRule             natural-language rule, scope, priority, effective_from,
                         effective_until, status
                         evidence: S02              confidence: high
                         → NEW table `business_rules`.

BusinessGoal             metric key, target value, period, unit
                         evidence: S02              confidence: high
                         → NEW table `business_goals`.

BrainQuestion            topic, question_key, prompt, why_it_matters, status,
                         answer, answered_at, check_in_months
                         evidence: S05              confidence: high
                         → NEW table `business_brain_questions` (catalogue + answers).

Conversation / Message    role, body, status, evidence jsonb, tool_calls, created_at
                         evidence: S07              confidence: high
                         → NEW tables `ai_conversations`, `ai_messages`, `ai_tool_calls`.

Approval                 action_type, payload jsonb, before/after jsonb, status,
                         idempotency_key, requested_by, approved_by, executed_at, error
                         evidence: S07              confidence: high
                         → NEW tables `ai_approvals`, `ai_execution_logs`.

Decision                 recommendation, decision, outcome, measured_before/after
                         evidence: S02 (decision history)  confidence: medium
                         → NEW tables `business_decisions`, `decision_outcomes`.

ScheduledReport          schedule, timezone, recipients, metrics, channel, status
                         evidence: S11              confidence: high
                         → NEW tables `scheduled_reports`, `report_deliveries`.

ExternalApiToken         token_hash, scopes, created_by, revoked_at, last_used_at
                         evidence: S13              confidence: high
                         → NEW table `external_api_tokens`.

Advertising              account, campaign, spend, impressions, clicks, conversions
                         evidence: S10              confidence: high
                         → NEW tables `advertising_accounts`, `advertising_campaigns`,
                           `advertising_insights` — EMPTY until a real connection exists.

Order / OrderItem / Product / Expense / Collection / Reconciliation
                         evidence: El Nour source + production   confidence: high
                         → EXIST. EasyOrders stays the source of truth for orders.

Courier / Shipment       carrier, tracking, status, fees, collected amount
                         evidence: S10 (Analify shipping)   confidence: medium
                         → El Nour has `orders.shipping_company/tracking_number` and
                           `collection_batches`; a dedicated courier table only if a
                           real courier API is connected.
```

Relationships: BusinessProfile 1-n KnowledgeItem · KnowledgeItem 1-n Source ·
Conversation 1-n Message 1-n ToolCall · Message 1-n Approval · Approval 1-n
ExecutionLog · BusinessDecision 1-n DecisionOutcome · ScheduledReport 1-n
ReportDelivery · ExternalApiToken 1-n (usage logs).

## Feature matrix

See `features.csv`. Must: 31 · should: 14 · could: 9 · skip: 8.

## Out of scope (cannot or should not be cloned)

- **Analify's brand** — name, logo, teal palette, marketing copy, illustrations.
  El Nour keeps its own emerald identity and its own Arabic product language.
- **Their AI credit / plan system** — El Nour uses the owner's own provider key.
- **Their agency/multi-brand workspace** — one store, one workspace.
- **Their partner network and connector marketplace** — no third-party app
  catalogue; El Nour builds the small set of connectors the business needs.
- **Their proprietary training pipeline** — El Nour's Brain trains from its own
  EasyOrders/database records through the same honest "checked against your
  numbers" idea, implemented locally.
- **Shipment creation / WhatsApp sending** — El Nour has no courier API and no
  approved WhatsApp sender. The approval workflow is built and real; the
  *executors* stay blocked until credentials exist, and the UI says so.

## Size

Screens 13 · flows 7 · entities 18. Hard parts: (1) profit honesty when the
cost data is missing, (2) tool-calling with per-role data access, (3) an
approval→execution path that cannot run twice, (4) a knowledge layer that
never turns an AI guess into a verified fact. Size: **XL** — phased build.
