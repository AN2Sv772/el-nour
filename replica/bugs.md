# Bugs — El Nour replica build

Format follows `replica-test/bug-report.md`. Only bugs that were **reproduced**
are listed here. Each entry has the reproduction, the severity, the fix and the
test that now keeps it fixed.

Severity (from the method): **S1** data loss / wrong money · **S2** a feature
broken, no workaround · **S3** broken with a workaround, or visibly wrong ·
**S4** cosmetic.

---

## B01 — S3 — The same number had two spellings on two screens

**Where** — `/dashboard` vs `/overview` (and the agent's answer card).

**Reproduction** — open `/dashboard`: the revenue reads
`‏٣١٥٬٨٨٠٫٠٠ ج.م.‏` (Arabic-Indic digits, a trailing dot after the currency,
and RTL marks). Open `/overview`: the same revenue reads `315,880 ج.م`. Same
number, two spellings, one owner.

**Cause** — `MetricCard` and `executive-overview.tsx` built their own
`Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' })`, while the
rest of the app used the shared `formatCurrency()` (`ar-EG-u-nu-latn`).

**Fix** — every money/count string now goes through `formatCurrency()` /
`formatNumber()` from `src/lib/utils.ts`: `metric-card.tsx`,
`executive-overview.tsx`, `src/lib/ai/answer.ts`, `app/agent/page.tsx`,
`app/decisions/page.tsx`, `app/api/orders/bulk/route.ts`.

**Kept fixed by** — `src/lib/utils.test.ts` ("uses Latin digits everywhere") and
`e2e/overview.spec.ts` → F05-H3 (the two screens must show the same revenue
for the same window).

---

## B02 — S3 — A duplicated React key silently dropped a row of the briefing

**Where** — `/briefing`.

**Reproduction** — open `/briefing` with the production data. The browser
console prints:

```
Encountered two children with the same key, `%s`. … task_no_deliveries
```

The critical "no deliveries" row appeared twice in the data (once as an
**anomaly**, once as a **decision** — both use the base id `no_deliveries`) and
React dropped one of the two rows from the list.

**Cause** — `buildBriefing()` built the task id as `task_${anomaly.id}` and
`task_${risk.id}`; the anomaly engine and the decisions engine use overlapping
id namespaces.

**Fix** — the ids are namespaced (`task_anomaly_*`, `task_decision_*`,
`task_missing_*`), and `buildBriefing()` now enforces uniqueness as a final
guard, so an id collision can never reach the UI again.

**Kept fixed by** — `src/lib/intelligence/briefing.test.ts` ("never produces two
tasks with the same id") and the e2e console-error guard, which fails any test
that logs a React key warning.

---

## B03 — S4 — A missing table produced an unusable error message

**Where** — `GET /api/ai/approvals` (and, by the same pattern, any route that
reads a table from a not-yet-applied migration).

**Reproduction** — call `/api/ai/approvals` before the migration is applied.
The response was:

```json
{"available":false,"approvals":[],"error":"Could not find the table 'public.ai_approvals' in the schema cache"}
```

A raw driver message: it says nothing about what to do.

**Cause** — the route returned `error.message` untouched.

**Fix** — `src/lib/api/missing-table.ts` turns a missing table into an
actionable 503: the human error, the exact migration file
(`20260124000000_ai_approvals.sql`), how to apply it (SQL Editor or
`scripts/apply-migrations.mjs`), and the raw message under `detail`.

**Kept fixed by** — `e2e/flows.spec.ts` → F04-N3 (the body must name the
migration file).

---

## B04 — S4 — The test plan itself was wrong about two things

**Where** — the e2e suite (not the product).

- The first version of F05-H3 compared money strings found anywhere on two
  screens. It failed because the two screens open on **different windows**
  (the cockpit on 7 days, the dashboard on 30). The test now sets both to the
  same window and compares the revenue values directly.
- The first version of the MCP test assumed the local server had the same API
  key as production. The test now reads `REPORTS_API_KEY` from the environment
  and, when it is missing, asserts the **fail-closed** contract (401/503)
  instead of pretending the endpoint works.

---

## To check (not reproduced — no claim made)

- The offline PWA shell, voice input, PDF/Excel/WhatsApp delivery and the live
  EasyOrders webhook are **not built**, so they were not tested.
- The three migrations are still not applied to production, so the approval
  flow (`/approvals` → execute → audit) was **not** exercised end-to-end; only
  its fail-closed path was.
- The write path of `/setup/costs` was not executed by the suite (it would
  change the owner's real cost data); the read path and the input validation
  were.

---

## Summary

| id | severity | status | fixed in |
|----|----------|--------|----------|
| B01 | S3 | fixed | this session (formatter unification) |
| B02 | S3 | fixed | this session (briefing task ids) |
| B03 | S4 | fixed | this session (`missing-table.ts`) |
| B04 | S4 | fixed | this session (test plan) |

**Open S1: none.** **Open S2: none.** No bug is left unfixed.
