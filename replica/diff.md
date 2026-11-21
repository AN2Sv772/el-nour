# replica-diff — El Nour vs. the Analify reference

**Method** — `replica-diff`: compare the built product against the reference
feature set, score the gap, and order what is left by the value it unlocks.

The comparison is **feature-parity in structure and honesty**, never in pixels
or wording: the reference is a clean-room target. What is measured is whether
the capability exists, whether it reads the store's real records, and whether
it tells the truth when the data is missing.

**Data source** — `replica/features.csv` (69 features, re-verified against the
live app and the live database on 2026-11-21).

---

## 1. Score

| status | count | share | meaning |
|--------|-------|-------|---------|
| `yes` | 32 | 46.4% | built, reading real records, honest when the data is missing |
| `partial` | 16 | 23.2% | the core works; a defined part is missing |
| `no` | 12 | 17.4% | not built |
| `not implemented` | 2 | 2.9% | out of scope for a single store |
| `skip` | 4 | 5.8% | not applicable to this business |
| `existing` | 3 | 4.3% | already present before this build (kept, not rebuilt) |

**Parity score** — `yes + partial + existing` = **51 / 69 = 73.9%** of the
reference surface is present in some working form.
**Full parity** — `yes + existing` = **35 / 69 = 50.7%**.
**Honesty gate** — every feature that is `yes` was checked against the rule
"no fake certainty": it either shows a number with its source, or it shows the
reason it cannot. **0 features violate it.**

The 18-point gap between "present" and "complete" is not 18 missing features:
it is 16 partials and 2 out-of-scope items.

---

## 2. Where the score comes from, by area

| area | features | yes | partial | no | verdict |
|------|---------:|----:|--------:|---:|---------|
| brain | 22 | 7 | 8 | 7 | the **knowledge layer** is written but not applied to production — the single biggest lever |
| agent | 11 | 7 | 1 | 3 | the deterministic agent works; the conversational layer is missing |
| finance | 10 | 6 | 3 | 1 | real math, missing the inputs (costs, expenses, collections) |
| analytics | 5 | 3 | 2 | 0 | the analytics that the data supports are built |
| approvals | 4 | 4 | 0 | 0 | **complete in code** — blocked only by the unapplied migration |
| connections | 2 | 2 | 0 | 0 | complete |
| shipping | 2 | 1 | 0 | 0 | one skipped (a courier API this business does not have) |
| marketing | 2 | 0 | 1 | 1 | the connector contract exists; no live ads platform |
| reports | 1 | 0 | 1 | 0 | on-demand + daily snapshots; no delivery channel |
| security / ui / operators / agency / brand / plans / integrations | 10 | 3 | 0 | 2 | mostly not applicable to a single store |

---

## 3. The gaps, ordered by what each one unlocks

### Gap 1 — The brain tables are written but not applied (7 `no` + 5 `partial`)

`business_brain`, `business_knowledge_sources`, `business_goals`,
`business_rules` — the migrations exist in `supabase/migrations/` and are
bundled in `supabase/pending-migrations.sql`, but they are **not applied to
production**, and this machine cannot apply them (Supabase CLI 403, no
`psql`, no Management token).

**Unlocks** — measurable goals, business rules in natural language, knowledge
sources with a verification date, add/edit/forget knowledge, knowledge search,
and the full brain status vocabulary.

**Cost** — one SQL execution by the owner. **Blocker** — access, not code.

### Gap 2 — The data the money needs (5 `partial` in finance)

No product costs, no operating expenses, no collection batches, no daily
reconciliation. Every one of them is **recorded in the product** (the metrics
engine marks the state, the UI withholds the number, `/setup/costs` opens the
cost gate) — but the numbers cannot appear until the owner enters them.

**Unlocks** — net profit, cash collected, ROAS, margin per order, and the
profit line on the trend chart. **Effort** — one session with the owner.

### Gap 3 — The conversational layer (3 `no` in agent)

No chart or table inside an answer card, no conversation history (search,
continue, delete), no page-context assistant.

**Unlocks** — the "ask the business anything" experience. The deterministic
tools behind it already answer correctly; what is missing is the layer that
renders them richly and remembers the thread. **Note** — it needs an AI
provider for the prose; the deterministic path works without one.

### Gap 4 — Documents into the brain (2 `no`)

No upload + review before saving, no CSV/XLSX import with review.

**Unlocks** — the owner teaching the business without writing SQL. This is the
difference between a dashboard the owner reads and a system the owner owns.

### Gap 5 — Ads and attribution (2 in marketing + 1 `partial` in finance)

The connector contract and the spend fields exist; no live platform is
connected, so ROAS is honestly "غير متاح" and ad profitability beyond platform
ROAS is not attempted.

**Unlocks** — "where does the money go" for paid traffic. **Blocked by** — an
ads account and a Meta/TikTok/Google credential.

### Gap 6 — Delivery of the reports (1 `partial`)

Reports are generated on demand and snapshotted daily by a cron; there is no
delivery channel (WhatsApp/email/PDF/Excel).

**Unlocks** — a report that arrives without being asked for. **Blocked by** —
a provider and, for WhatsApp, an approved template.

### Gap 7 — Knowledge conflicts (1 `no`)

A fact that contradicts a record is not surfaced to the owner as a conflict.

**Unlocks** — the "trust but verify" loop: the system says "the sheet says X,
the orders say Y" instead of silently preferring one.

---

## 4. What is deliberately different from the reference

| reference | El Nour | why |
|-----------|---------|-----|
| the AI writes the analysis | the **engines** compute, the AI may only phrase | "Math before AI": a model may never introduce a number that is not in the evidence |
| every screen shows a number | a number **or the reason it cannot** | "Profit is withheld" — the gap is a first-class answer |
| one currency style | `315,880 ج.م` everywhere, Latin digits | one owner, one spelling of the same number (bug B01) |
| a general assistant | Egypt-first: EGP, Cairo timezone, Arabic-first RTL, COD | the market this store actually operates in |

---

## 5. The next build order (value per unit of effort)

1. **Apply the three migrations** (owner action, minutes) → unlocks Gap 1 and
   the whole approval flow.
2. **Enter the real costs and expenses with the owner** (one session) →
   unlocks Gap 2 — the profit appears.
3. **The conversational layer** (3 features) → unlocks Gap 3.
4. **Document import with review** (2 features) → unlocks Gap 4.
5. **Ads connector + delivery channel** → unlock Gaps 5 and 6 — they need
   external accounts, so they start only when the owner is ready.
6. **Knowledge conflicts** (1 feature) → Gap 7.

Steps 1 and 2 are not code. They are the two gates that turn a working system
into an honest one with money in it.
