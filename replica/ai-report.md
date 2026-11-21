# AI report — El Nour Business OS

**Date** — 2026-11-21 · **Scope** — every place the product uses AI, what it
is allowed to do, and what it is forbidden to do.

---

## 1. The governing rule: Math before AI

The AI is the **voice**, never the **calculator**.

```
question → intent → tool → engine → evidence → answer
                                        ↑
                            (the model may only phrase this)
```

- Every tool call lands in a **pure engine** (`src/lib/metrics`,
  `src/lib/overview`, `src/lib/analytics`, `src/lib/decisions`,
  `src/lib/intelligence`) with a real query against the real tables.
- The answer carries an `evidence` block: the calculation, the source tables,
  what is missing, and the metric values that were actually used.
- When a provider IS connected, the model may rephrase the answer text. It
  may not introduce a number that is not in `evidence` — the evidence is the
  contract, and the deterministic builder is the fallback of record.

**Consequence** — the assistant answers correctly today, with **no AI
provider configured at all**. The provider is an upgrade to the prose, not a
prerequisite for the truth.

## 2. What the AI layer consists of

| module | role | state |
|--------|------|-------|
| `src/lib/ai/intent.ts` | classify the question (sales, profit, products, orders, cash, decisions…) | built, tested |
| `src/lib/ai/tools.ts` | the tools the agent may call — each one wraps an engine | built, tested |
| `src/lib/ai/answer.ts` | the deterministic answer builder: text + evidence + follow-ups | built, tested |
| `src/lib/ai/approvals.ts` | the proposal model, the allowed actions, the idempotency key | built, tested |
| `src/lib/ai/actions.ts` | the executor — **admin only, permissions re-checked at execution** | built, tested |
| `src/lib/ai/provider.ts` | the optional model provider (OpenAI-compatible + Anthropic) | built, **9 tests with a mock HTTP server** |

## 3. The provider

| property | state |
|----------|-------|
| supported protocols | OpenAI-compatible (`/chat/completions`) and Anthropic (`/messages`) |
| timeout | enforced, with a clean error — never an open hang |
| auth failures | surfaced as an error, never silently retried into a wrong answer |
| credentials at rest | AES-256-GCM, decrypted in the server only |
| tested without a key | yes — a local mock HTTP server covers openai_compatible, anthropic, timeout, 401 and the encryption round-trip (9 tests) |
| configured in production | **no** — the provider branch is dormant; the deterministic path serves every request |

The absence of a provider is a **capability limit, not a broken feature**, and
the UI says which mode answered: "without a model connected, the tools answer
deterministically".

## 4. The approval pipeline (the "AI may propose, the owner disposes" rule)

```
proposal ──▶ ai_approvals (pending, idempotency_key, impact_summary,
           │                risk_level, reversible, requested_by)
           ▼
        owner opens /approvals ──▶ Allow / Reject
           │
           ├─ permissions re-checked AT EXECUTION (an employee cannot approve)
           ├─ idempotency key re-checked (a double click runs it once)
           ├─ the action executes atomically (or nothing happens)
           └─ a business_audit row records the before/after
```

- The allowed actions are a closed list: `set_product_cost`, `add_expense`,
  `set_business_setting`. Nothing else can be proposed.
- Every proposal states **what changes, why, how severe, and whether it can be
  undone**.
- The route answers **503 with the migration filename** until the approvals
  table exists — it fails closed and tells the operator exactly what to run.

**Current state** — the whole path is written and unit-tested, but the table
is not applied to production, so the end-to-end approval was exercised only in
its fail-closed form.

## 5. What the product refuses to let the AI do

| forbidden | why | where it is enforced |
|-----------|-----|----------------------|
| print a profit while the costs are missing | a wrong number is worse than no number | the engine returns `null` + a reason; the UI shows `—` |
| invent a number that is not in the evidence | "no fake certainty" | `answer.ts` builds the text from the metric values; the evidence is the contract |
| claim certainty without data | the risk engine marks `dataLimited` and drops its confidence when there is no delivery history | `risk.ts` |
| reject a customer automatically | a wrong rejection costs a sale and a customer | the risk page offers **verification only** |
| execute anything without an approval | the owner's consent is the product | `ai_approvals` + the execution-time role check |
| leak the service role key or the API key to the browser | a key in the client is a published key | the keys are read from `process.env` on the server only |
| promise certainty in a forecast | a forecast without its error is a lie | `forecast.ts` publishes the measured MAPE, the backtest and the confidence band |

## 6. The analytic engines (the "AI" that is not a model)

| engine | what it does | why it is deterministic |
|---------|--------------|-------------------------|
| `risk.ts` | scores each COD order from the refusal history, the frequency, the duplicates, the missing phone/address, the ageing and the value outlier | a risk score must be reproducible and explainable — every signal is printed with its evidence |
| `anomaly.ts` | flags no delivery, no payment state, a shipping-fee mismatch, backlog growth, an out-of-range day (leave-one-out MAD), a product concentration, aged orders and incomplete data | an anomaly is a comparison against a baseline, not an opinion |
| `forecast.ts` | naive / moving-average / linear-trend, a **time-ordered backtest** with the measured MAPE, an 80% band, and depletion dates only when the inventory is tracked | a forecast without its measured error is a guess with a chart around it |
| `simulator.ts` | nine levers, break-even, contribution, max CAC — read-only, and the profit stays `null` when its inputs are missing | a simulation that invents a margin teaches the owner a false lesson |
| `briefing.ts` | turns the day's numbers into lines and tasks, and publishes its blind spots | the daily briefing is read in 30 seconds; it cannot contain a guess |

**Tests** — 42 across the five engines, plus 449 in the project in total.

## 7. The honest status of the AI layer

| capability | state |
|------------|-------|
| the assistant answers real questions from the real data | **working** (deterministic) |
| the assistant shows the calculation and the sources with every answer | **working** |
| the assistant refuses to answer when the data is missing | **working** |
| the assistant proposes changes for approval | **built**, blocked by the unapplied migration |
| the assistant executes an approved change | **built**, blocked by the unapplied migration |
| the assistant writes the prose itself | **built, dormant** — no provider configured |
| the assistant remembers the thread and shows charts in the answer | **not built** (see `replica/diff.md`, Gap 3) |
| the assistant reads the document the owner uploaded | **not built** (Gap 4) |

## 8. The verdict

The AI layer is **honest and complete in structure**: it can read, calculate,
explain, refuse, propose and — with the owner's approval — act. What it cannot
do yet is *speak in a model's voice* (no provider) and *remember* (no thread
storage). Neither of those affects the correctness of the answers; both affect
the experience.

The single most important AI decision in this build is the one the product
makes every day: **it would rather show nothing than show a number it cannot
prove.**
