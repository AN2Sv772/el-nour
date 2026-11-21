# QA report — El Nour Business OS

**Date** — 2026-11-21 · **Method** — `replica-test` · **Environment** — the
local dev server against the **live production database**, authenticated with a
minted admin session. No mock data, no seeded data.

---

## 1. What was run

| layer | tool | count | result |
|-------|------|------:|--------|
| Unit — the pure engines, the formatters, the AI provider (mock HTTP server) | Vitest | **449** across 37 files | **449 passed** |
| End-to-end — the screens and the API surface | Playwright (desktop) | **28** | **28 passed** (with the API key exported; without it the MCP spec asserts the fail-closed path and reports itself as skipped — see §4) |
| End-to-end — the responsive contract | Playwright (mobile/Pixel 7) | **6** | **6 passed** |

**Full-suite result: 34/34 passed** (desktop 28 + mobile 6).
| Types | `tsc --noEmit` | — | clean |
| Production build | `next build` | 24 routes | clean |

**The e2e suite fails on any console error and on any 5xx response.** A React
warning or a broken route cannot pass silently — that guard is what caught
bug B02.

## 2. The flows that were exercised

| flow | cases | status |
|------|------:|--------|
| F01 — the owner asks a business question | 8 (manual + API) | pass (deterministic path) |
| F04 — AI prepares a change, the owner approves it | 6 | 5 pass · 1 blocked by the unapplied migration (fail-closed verified) |
| F05 — the owner checks today's business | 8 | **pass** — the cockpit and the dashboard agree on the same window |
| F12 — COD risk review | 5 | pass |
| F13 — anomalies | 4 | pass |
| F14 — demand forecast | 5 | pass |
| F15 — the profit simulator | 6 | pass |
| F16 — the daily briefing | 4 | pass (after B02) |
| F17 — cost entry | 4 | pass (read + validation; the write was deliberately not executed) |
| F18 — performance | 3 | pass (2.47 s cold · 0.35 s cached) |

The full plan with the case ids is `replica/test-plan.md`; the defects are
`replica/bugs.md`.

## 3. The defects this round found — and fixed

| id | severity | what | fixed by |
|----|----------|------|----------|
| B01 | S3 | the same money figure had two spellings on two screens (Arabic-Indic digits + "ج.م." on the dashboard, Latin digits + "ج.م" on the cockpit) | one formatter (`formatCurrency`/`formatNumber`) across 6 files + 2 tests |
| B02 | S3 | a duplicated React key silently dropped the "no deliveries" row from the briefing (the anomaly and the decision share the base id `no_deliveries`) | namespaced task ids + a uniqueness guard in `buildBriefing` + a unit test |
| B03 | S4 | a missing table answered with a raw driver message that said nothing about what to do | `src/lib/api/missing-table.ts` — the 503 now names the migration file and how to apply it |
| B04 | S4 | two test-plan defects (comparing two screens on different windows; assuming the local API key equals the production one) | the tests now align the window and assert the fail-closed contract |

**Open S1: none · Open S2: none.** No bug is left unfixed.

## 4. The one skipped test

`The MCP server answers initialize and lists its tools` is **skipped only when
`REPORTS_API_KEY` is not exported** into the test runner's environment. The
skipped path asserts the **fail-closed** contract (401/503 without a key), so
it is still a real assertion — it just cannot check the positive path. The
final run exported the key and the spec **passed** in full (`initialize` +
`tools/list` + the three tool names). The local dev server runs with a
separate local key; production has its own secret.

## 5. What was deliberately NOT tested, and why

| not tested | why |
|------------|-----|
| the write path of `/setup/costs` | it would change the owner's real cost data — it needs an explicit approval to run |
| the approval → execution → audit path | the `ai_approvals` table does not exist in production yet; only the fail-closed path was exercised |
| the offline PWA shell, voice input | not built |
| PDF/Excel/WhatsApp delivery | not built (no provider) |
| a live EasyOrders webhook | needs a real order from the vendor |
| the AI provider against a real vendor | no provider key; the protocol paths are covered by a mock HTTP server |

These are listed in `replica/test-plan.md` under "Manual pass" and in
`replica/bugs.md` under "To check" — **no claim is made about them.**

## 6. Regression guards added this round

| guard | where |
|-------|-------|
| the numbers are spelled the same way everywhere | `src/lib/utils.test.ts` — "uses Latin digits everywhere" |
| the briefing never produces two tasks with the same id | `src/lib/intelligence/briefing.test.ts` |
| a missing table names the migration | `e2e/flows.spec.ts` — F04-N3 |
| no console error and no 5xx on any screen | `e2e/helpers.ts` — the per-test guard |
| the two screens report the same revenue for the same window | `e2e/overview.spec.ts` — F05-H3 |
| no horizontal overflow at 360 → 1440 px | `e2e/responsive.spec.ts` |

## 7. QA verdict

| criterion | verdict |
|-----------|---------|
| the engines are correct | **pass** — 449 unit tests |
| the screens render the real data | **pass** — 33 e2e checks against the live database |
| the screens tell the truth when the data is missing | **pass** — the withheld-profit and unavailable states are asserted, not assumed |
| the UI is free of runtime errors | **pass** — the console guard is on |
| the app is responsive | **pass** — 6 widths × 7 screens, no horizontal overflow |
| the types and the build are clean | **pass** |
| the whole product is end-to-end verifiable | **partial** — blocked by the unapplied migrations and the missing provider, both named above |

**The product is QA-clean for everything it can prove. What it cannot prove is
listed explicitly rather than assumed.**
