# Build log — El Nour (Analify-inspired transformation)

Method: `replica-build` (clean-room rebuild from `replica/recon.md`), then
`replica-test`, then `replica-diff`. Every screen below is written from
scratch against El Nour's real data layer — no original code, assets or copy.

Legend: **done** = implemented + tested + verified live · **partial** = works
but a state/input is missing · **blocked** = needs an external dependency.

| ID | Screen | Route | Date | Status | What is missing | Harder than expected |
|----|--------|-------|------|--------|-----------------|----------------------|
| S01 | Executive home | `/dashboard` | 2026-11-21 | partial | AI prose observations (deterministic rules only); profit chart line while costs are missing | Keeping "actual vs estimated" visible on every single card instead of a single disclaimer |
| S02 | Business Brain → Overview | `/brain` | 2026-11-21 | partial | Brain tables not applied in production → status is "degraded" | The honest degradation path: the screen must work even when its own storage is missing |
| S03 | Business Profile | `/brain/profile` | — | planned | Needs `business_profile` row | — |
| S04 | Knowledge Graph | `/brain/knowledge` | — | planned | Needs `business_knowledge` | — |
| S05 | Questions for you | `/brain/questions` | 2026-11-21 | partial | Brain table pending | — |
| S06 | Assets Library | `/brain/assets` | — | planned | Needs storage + review flow | — |
| S07 | Aziz chat → El Nour agent | `/agent` | 2026-11-21 | partial | No conversation persistence; no charts inside answers | Making a deterministic answer (no LLM) still feel like an assistant |
| S08 | Business Dashboards | `/analytics` | 2026-11-21 | partial | Customer analytics tab missing | Cash flow must read *batches*, not orders — wrong source would have produced a fake 315K "cash" |
| S09 | Finance | `/analytics` (P&L tab) | 2026-11-21 | done | — | The P&L must *withhold* subtotals; every naive implementation prints sales as profit |
| S10 | Ads | `/marketing` | 2026-11-21 | partial | No live ad platform → "غير متاح" | Refusing to render a fake ROAS was the whole point |
| S11 | Reports | `/reports` | 2026-11-21 | partial | No delivery channel (email/WhatsApp) yet; snapshot cron added | The old page published a fake profit (323,445 = sales) — rebuilt on the analytics engine |
| S12 | Settings → Integrations | `/settings/integrations` | 2026-11-21 | done | — | — |
| S13 | MCP / AI connections | `/api/mcp` + `/settings/connections` | 2026-11-21 | partial | Token scoping UI (single key today) | Failing closed (503) when the key is unset was deliberate |
| S14 | Approvals | `/approvals` | 2026-11-21 | partial | Table pending in production | Exactly-once execution + before/after snapshots |
| S15 | Decisions | `/decisions` | 2026-11-21 | done | — | Converting a rule into a *proposal* (needs approval) instead of a silent fix |
| S16 | Cost setup | `/setup/costs` | 2026-11-21 | done | — | — |
| S17 | Business Overview (profit cockpit) | `/overview` | 2026-11-21 | partial | Ads leg unavailable until a platform is connected | RTO exposure + cash-missing are *real* for a COD store; profit/ROAS are not |
| S18 | COD risk | `/risk` | 2026-11-21 | partial | No delivered outcomes → risk scores stay "insufficient data" | Refusing to score risk without delivery history |
| S19 | Anomalies | `/anomalies` | 2026-11-21 | done | — | — |
| S20 | Demand forecast | `/forecast` | 2026-11-21 | partial | Demand = orders placed, not confirmed demand | Baseline + holdout error instead of a fashionable model |
| S21 | Profit simulator | `/simulator` | 2026-11-21 | partial | Net profit needs cost data → shows revenue/cash effects only | Non-destructive by construction (pure functions, no writes) |
| S22 | Daily briefing | `/briefing` | 2026-11-21 | done | — | — |

## Notes

- The **clean-room rule** was kept: no Analify code, no Analify assets, no
  Analify copy. The reference screenshot informed *information architecture*
  (which numbers sit together), not pixels.
- Every screen that shows money has exactly one definition of that money:
  `src/lib/metrics/engine.ts` → `src/lib/analytics/finance.ts`. No page
  computes its own revenue.
- The `features.csv` "status" column is the truth ledger. Rows that are
  blocked by a missing table are `partial`/`no`, never `yes`.

## Phase `replica-test` — 2026-11-21

| artefact | state | notes |
|----------|-------|-------|
| `replica/test-plan.md` | done | 58 planned cases across F01–F18 (happy / edge / negative), each with its expected result |
| `e2e/` (Playwright) | done | `helpers.ts` (minted admin session + the console-error and 5xx guards), `overview.spec.ts`, `intelligence.spec.ts`, `flows.spec.ts`, `responsive.spec.ts` + `playwright.config.ts` |
| `replica/bugs.md` | done | 4 reproduced bugs (B01–B04), all fixed, no open S1/S2 |
| Unit suite | done | 449 tests across 37 files (was 440 — 9 added) |
| E2E run | done | 28 desktop + 6 mobile = **34/34**, all green against the live database |

### The bugs the e2e run found

| id | severity | what | fix |
|----|----------|------|-----|
| B01 | S3 | the same money figure printed two ways (Arabic-Indic digits + "ج.م." on the dashboard vs Latin digits + "ج.م" on the cockpit) | one formatter (`formatCurrency`/`formatNumber`) across 6 files |
| B02 | S3 | a duplicated React key dropped the "no deliveries" row from the briefing (the anomaly and the decision share the base id `no_deliveries`) | namespaced task ids + a uniqueness guard in `buildBriefing` |
| B03 | S4 | a missing table answered with a raw driver message | `src/lib/api/missing-table.ts` — the 503 names the migration file and how to apply it |
| B04 | S4 | two test-plan defects (comparing screens on different windows; assuming the local API key = the production key) | the tests now align the window and assert the fail-closed contract |

## Phase `replica-diff` — 2026-11-21

| artefact | state | notes |
|----------|-------|-------|
| `replica/diff.md` | done | the parity score, the gap list ordered by what each gap unlocks, and what is deliberately different from the reference |
| `replica/product-report.md` | done | §23 Product |
| `replica/technical-report.md` | done | §23 Technical |
| `replica/financial-report.md` | done | §23 Financial |
| `replica/ai-report.md` | done | §23 AI |
| `replica/qa-report.md` | done | §23 QA |
| `replica/production-readiness-report.md` | done | §23 Production-Readiness |

**The parity score** — `yes + partial + existing` = 51/69 = **73.9%** present in
some working form; `yes + existing` = 35/69 = **50.7%** complete. 0 features
violate the honesty gate. The biggest lever is not code: the three migrations
must be applied to production (owner action) and the real costs/expenses must
be entered (owner session).

---

## Visual fidelity round — LTR mirroring (2026-11-21)

The Analify reference ships an English LTR shell; the earlier build translated chrome labels but hard-coded `dir="rtl"` kept the layout RTL. This round makes the language switch a **real direction flip**:

| Issue | Fix |
|-------|-----|
| Hard-coded `dir="rtl"` on `DashboardLayout` + 12 pages | Removed; shell now inherits `<html dir>` from `LanguageProvider` |
| Duplicate store chip (sidebar header + top bar) | Top-bar chip hidden at `lg:` (`lg:hidden`) |
| Floating AI launcher covering table rows | Moved to inline-end corner on `lg:`, hidden on mobile (`hidden lg:flex`) |
| Mobile drawer empty (ref-gate bug) | Replaced with `useAuth()`; no async fetch needed |
| Missing dictionary keys for mobile/assistant | Added `nav.more`, `common.close`, `ai.question`, `ai.attach`, `ai.voice` |
| Screenshot script leaked language across pages | `capture-design.cjs` sets `localStorage` per page via `addInitScript` |
| F05-H3 e2e locator brittle (`following-sibling::p`) | Added `data-metric-key` / `data-metric-value` hooks; spec updated |

**Verification**:
- `tsc --noEmit` ✅ | `npm test` ✅ 453/453 | `playwright test` ✅ 36/36 | `npm run build` ✅ 54 routes
- 9 fresh screenshots in `replica/design/elnour/`: EN LTR sidebar left, AR RTL sidebar right, no duplicate chip, AI launcher cornered, mobile dock Arabic with Assistant link.

---

## Security hardening round — 2026-11-22

Four parallel audits (auth/RBAC · external API + MCP · data layer · secrets/crypto/webhook)
ran over the whole app; every finding was fixed in the tree, then verified.

| area | fix |
|------|-----|
| role resolution | `getUserRole` returns `null` for a missing profile, `is_active = false`, a read error, or an unknown role → **403**, not a default role |
| registration | allow-list only (`REGISTRATION_ALLOWED_EMAILS`); unset = closed (403); new accounts start `viewer` + inactive |
| role escalation | `reconciliation`, `order-confirmation` (PUT), `brain/knowledge` (forgotten), `ai/chat` (proposals) → manager+ |
| filter injection | `products/route.ts`: column allow-list, quoted `.or()`, UUID validation, bounded sort/page params |
| validation | `patchProductSchema` (bounded price/cost) applied before the field allow-list |
| CSV | formula-injection neutralisation for `=`, `+`, `-`, `@` |
| secrets | placeholder/short-key rejection, timing-safe `safeEqual`, Gemini key moved to the `x-goog-api-key` header |
| middleware | client IP from trusted proxy headers; open redirect closed (`redirectTo` must start with a single `/`) |
| inventory | integer quantity ≤ 1,000,000 + optimistic concurrency (409 on conflict, compensating delete) |
| orders | server-derived totals (`round2`), discount capped at the subtotal |
| error leakage | raw driver errors replaced by generic messages + a UUID `reference` |
| cron / internal | timing-safe secret comparison + self-origin pinning (`INTERNAL_ORIGIN`) |
| MCP | 20-message batch cap |

### Database bugs found (they would have failed on apply)

1. **`report_snapshots` would have rolled back entirely** — it called the two-argument
   `app_has_role(auth.uid(), text[])`, but the live database only has the one-argument
   `app_has_role(minimum text)`. The SQL Editor wraps the file in one transaction, so
   the table would not have been created. Fixed to `app_has_role('viewer')` /
   `app_has_role('manager')`.
2. **`created_at` was overwritten on UPDATE**, destroying the timestamp that makes a
   snapshot an immutable record of when the day closed. Added `updated_at` + a trigger
   that maintains it.
3. **`handle_new_user` minted `employee` + active** — any public signup became a
   business-write account with access to the customer export. Now `viewer` + inactive.
4. **Self-promotion through RLS** — the "Users can update own profile" policy let a
   signed-in account write `{"role":"admin"}` to its own row with the public anon key.
   Added `20260126000000_lock_user_profile_role.sql` (pinned self-update policy +
   `REVOKE UPDATE (role, is_active)`).
5. **`exec_sql` template removed** — `run_migrations_final.js` carried a
   `SECURITY DEFINER` + `GRANT ... TO anon` template for an arbitrary-SQL RPC. Never
   executed, but one paste into the SQL Editor would have handed the database to the
   open web. All three legacy scripts now delegate to `scripts/apply-migrations.mjs`.

**Verification**:
- `tsc --noEmit` ✅ clean | `npm test` ✅ **458/458** (38 files) | `npm run build` ✅ **91 routes**
- `npm run test:e2e` ✅ **36 passed / 1 skipped** (the skip is the MCP test — no
  `REPORTS_API_KEY` set, which is the correct fail-closed contract)
- Fresh clone of the pushed repo: identical file set, secret scan clean, no `.env.local`

**Still owner-only (no credentials available to the agent):** rotate
`SUPABASE_SERVICE_ROLE_KEY`, apply the pending migrations, set `REGISTRATION_ALLOWED_EMAILS`
/ `INTERNAL_ORIGIN` / `CRON_SECRET` in the deployment environment, and deploy.
