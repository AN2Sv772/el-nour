# Final Acceptance Report

**Target** El Nour Dashboard · `/Volumes/1/el nour dashboard/el-nour-dashboard`
**Production** https://el-nour-dashboard.vercel.app · **Supabase** `lyswmlmrlviptprhfiph`
**Run** `security-audit-skill/el-nour-dashboard/run-1` · **Closed** 2026-11-20 ~21:30 Cairo

---

## 1. Acceptance decision

| Area | Decision |
|---|---|
| **Continue operating the production service** | **ACCEPTED** — no exploitable path to data loss, privilege escalation or a credential leak remains open |
| **Accept the repair set into the source tree** | **ACCEPTED** — 45 distinct files (35 remediation entries), verified by the same harness, **279/279 tests**, clean `tsc`, successful production build |
| **Deploy the repair set now** | **NOT DECIDED BY THE AUDITOR** — a staged plan exists (`audit/19_REMEDIATION_LOG.md` §5) and needs the owner's approval |
| **Accept the confirmed finding that remains open** | **ACCEPTED AS KNOWN — F-011**: the EasyOrders platform has not called the store webhook since **2026-11-06**; every order arrives through the periodic scanner (94 % later than 24 h, overall median 29.5 days). The application side is verified correct — the cause is in the seller panel and is an owner action |
| **Accept the four fixes of the second pass** | **DONE in the working tree (not deployed)** — F-012 (atomic counters), F-013 (sync log per run), F-017 (export date boundaries), F-018 (accessibility) — each re-verified, evidence under `audit/evidence/` |
| **Accept the three owner decisions** | **PENDING** — F-014 (settings role), F-015 (unknown-event policy), F-016 (version control) |

## 2. What the run covered

| Dimension | Extent |
|---|---|
| API surface | 68 endpoint/method combinations × 5 identities = 538 planned probes (429 sent, 109 blocked by the safety guard) |
| Production build | fully probed, including the malformed-input and wrong-method variants |
| Repaired build | the identical harness, for a like-for-like comparison |
| Database | 28 integrity checks over 19 tables (2 023 orders · 1 922 customers · 12 products) |
| Browser | 13 routes (first pass) + 11 routes re-measured on the repaired build: accessibility semantics, structure, console errors, network failures, responsive behaviour at 6 widths |
| Integrations | EasyOrders end to end: webhook, workers, credentials, configuration, delivery history |
| Deploy artefacts | `vercel.json` crons, the middleware, the env files, the dependency tree |

## 3. Findings and their disposition

| Verdict | Count | IDs |
|---|---|---|
| confirmed — fixed and re-verified | 15 | F-001 … F-010, F-012, F-013, F-017, F-018 |
| confirmed — open (owner action outside the repository) | 1 | F-011 |
| needs-validation — owner decision | 3 | F-014, F-015, F-016 |
| rejected by measurement | 1 | F-019 |

Severity of the confirmed set: **3 high** (credential wipe, viewer-accessible import
workers, ineffective column revocation), **7 medium**, **6 low**. All three high-severity
findings are closed.

> **Correction notice (second measurement pass, 2026-11-20).** The first pass reported
> F-011 as *rejected* and filed the stale `last_webhook_at` as F-012. Both statements were
> wrong and are corrected here: the `order_created` rows in `automation_logs` are written
> by the **scanner**, not by the webhook handler, so they do not prove a delivery; the
> handler's own marker (`webhook_received`) has **zero** rows. F-011 is therefore
> **confirmed**, the stale-`last_webhook_at` finding is **withdrawn**, and F-012's slot
> now carries the **lost-update counter defect** (`19` counted against `2 022` imports).
> The detailed evidence is in `audit/04_FINDINGS_INDEX.md` and `audit/09_EASYORDERS_INTEGRATION.md`.

## 4. The numbers that prove the repair

| Indicator | Before | After |
|---|---|---|
| HTTP 500 from the probe harness | **21** | **1** (local encryption-key artefact only) |
| HTTP 400 (correct rejection of malformed input) | 40 | 65 |
| HTTP 404 (correct rejection of a missing row) | 13 | 15 |
| viewer access to the import workers | 200 (write) | **403** |
| `DELETE /api/integrations/easyorders` | destructive | **400** without a confirmation token; soft disconnect with it |
| `POST /api/integrations/easyorders/import-test` | writes to production | **403** unless explicitly enabled |
| the order-confirmation cron without a secret | reachable | **503** fail-closed |
| rate-limit buckets | unbounded | **≤ 10 000**, expired entries swept |
| unit tests / type check | — | **279/279** (22 files), `tsc --noEmit` clean, `npm run build` compiled |
| findings validator / ledger validator | failing | **PASS** / **PASS** |
| `easyorders_config.total_imported_orders` vs. real imports | 19 / 2 022 | **atomic increment** (fixed; migration prepared) |
| `easyorders_sync_logs` rows written by the scanners | 0 | **one row per run** (`backfill` / `catch-up`) |
| export row set vs. list row set | 3 orders missing | **identical** (506/506 · 1329/1329 · 43/43), invalid bound ⇒ HTTP 400 |
| accessibility: unnamed controls / unlabelled fields / routes without `h1` | 32 / 13 / 6 | **0 / 0 / 0** over 11 routes, skip link present |

## 5. Incident INC-001 — closed

The audit itself erased the EasyOrders credentials through `DELETE
/api/integrations/easyorders` (the handler nulled the encrypted key with no confirmation
and no backup). The integration was restored from the EasyOrders dashboard within the same
session and verified end to end:

| Step | Result |
|---|---|
| `PUT /api/integrations/easyorders` (admin) | 200 — "تم حفظ الإعدادات بنجاح" |
| `GET /api/integrations/easyorders` | `has_api_key=true`, `masked=93a4••••••••••••2fcc`, correct `store_id` |
| `POST …/test` | 200 — "تم الاتصال بنجاح", `is_connected=true` |
| `POST …/webhook-config {mode:"self-test"}` | 200 — `endpointLive/secretAccepted/secretEnforced = true`; a wrong secret ⇒ 401 |
| harness hardening | every mutating probe is now blocked before transmission (109 per run) |
| permanent fix | soft disconnect + confirmation token + `audit_log` row |

**Residual exposure:** about 15 minutes without automated imports; the backlog was
imported afterwards (`last_sync_at = 2026-11-20T18:45:16Z`).

## 6. Data-integrity statement

| Statement | Result |
|---|---|
| business rows deleted by the audit | **0** |
| business rows modified by the audit | **0** |
| audit-created rows removed | 4 (run 1) + 3 (collections) + 1 (expense) + 1 (reconciliation) + 4 (dead letters) + 18 (rejected probes) = **31** |
| rows the audit could not remove | 6 `audit_log` rows — the database forbids it (`42501`), which is the correct behaviour |
| accounts created by the audit | 1 (temporary viewer) — **deleted at the end of the run** |
| side effects disclosed | the catch-up/backfill probes performed **real EasyOrders imports** (8 orders, 7 customers — genuine store data, no synthetic rows) |

Final production counts: orders 2 023 · order_items 2 023 · customers 1 922 · products 12 ·
automation_logs 2 022 · `user_profiles` 2 (admin + employee).

## 7. What was deliberately *not* done

| Not done | Why |
|---|---|
| deploy anything | the task forbids automatic deployment; a staged plan is provided |
| rotate `CREDENTIALS_ENCRYPTION_KEY` | it would invalidate every stored secret; the risk was accepted and documented |
| delete `audit_log` | the database forbids it — and it should not be circumvented |
| create a synthetic order in the live store | it would put fake data into a live business |
| invent product costs to make COGS non-zero | the zero cost is a **data** problem; faking it would corrupt the profit reports |
| delete the 6 `audit_log` entries through an admin channel | same as above |
| test account creation, password-reset e-mail delivery | they would create users / send real e-mail in production |

## 8. Residual risk register (accepted)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **F-011** | **the platform does not call the webhook — every order arrives through the scanner and is up to a month old (94 % > 24 h; median 29.5 days)** | **certain** | **medium** (the business acts on stale orders; a missed order is invisible until the next scan) | **owner action: re-register the webhook in the EasyOrders seller panel and watch for a `webhook_received` marker.** Code side delivered: the marker and `last_webhook_at` are now measured on every run. Until it is re-registered, raise the scan frequency / treat the import lag as the real latency |
| F-012 | the import counters lose updates (`19` against `2 022`) | certain | low (observability) | **fixed** in the working tree (atomic increment); the migration has to be applied to production |
| F-013 | the scanners left no `easyorders_sync_logs` row | certain | low (audit trail) | **fixed** in the working tree (one row per run) |
| F-017 | the export omitted three orders per Cairo-day edge | certain | low | **fixed** and re-verified (identical row sets) |
| F-018 | 32 unnamed controls, 13 unlabelled fields, 6 pages without `h1` | certain | low | **fixed** and re-verified (0 / 0 / 0) |
| DB-16 | every product has `cost_price = 0` → no COGS | certain | **medium** (the profit reports are meaningless) | data work: enter the costs |
| DB-26 | 76/76 business days are not reconciled | certain | medium (the reconciliation screen has no data) | run a daily closing routine, or hide the screen |
| F-014 | the settings route is stricter than its peers | certain | low | owner decision |
| F-016 | no version control | certain | medium (no rollback, no change history) | owner decision — a private repository is the single highest-value remaining action |
| — | the rate limiter is per instance and per path | likely | low | a shared store (Redis) if the traffic grows |
| — | the dashboard has no cache (6.0 s cold request) | likely | low | a 30–60 s cache; see `audit/17_PERFORMANCE.md` |

## 9. Recommended order of action

1. **Re-register the EasyOrders webhook** (F-011) — this is the only confirmed finding
   left open, it is invisible to the customer, and it is an owner action in the seller
   panel, not a code change.
2. **Accept and deploy** the repair set through the staged plan in
   `audit/19_REMEDIATION_LOG.md` §5 (preview → probe → deploy → probe), including the
   migration `20260122000000_easyorders_atomic_sync_log.sql` (the code works with or
   without it).
3. **Put the project under version control** (F-016) — before the next change, not after.
4. **Enter the product costs** — until then the profit and reconciliation reports cannot
   be trusted (DB-16).
5. Decide F-014 and F-015 with the owner.
6. Run the daily reconciliation and check that the collections flow is used as intended.

## 10. Deliverables

| Artefact | Location |
|---|---|
| 21 audit documents | `audit/00_…` … `audit/20_…` |
| raw evidence | `audit/evidence/` (probe results ×3, integrity report, UI audit, export probe, performance, cleanup report, the harness itself) |
| machine-readable findings | `~/security-audit-skill/el-nour-dashboard/run-1/findings.json` (validator PASS) |
| coverage ledger | `~/security-audit-skill/el-nour-dashboard/run-1/coverage-ledger.json` (validator PASS, 20/20) |
| run metadata + architecture | `~/security-audit-skill/el-nour-dashboard/run-1/run-metadata.json`, `architecture.md` |
| repair set | 45 distinct files (35 remediation entries) in the working tree — **not deployed** |
| cleanup report | `audit/evidence/cleanup_report.json` (before/after counts) |
| second-pass evidence | `audit/evidence/ui_audit_local.json` (11 routes), `audit/evidence/export_bounds_probe.json` (506/1329/43), `audit/evidence/sync_counters_probe.json` (19 vs 2 022), `scripts/verify-export-bounds.cjs`, `scripts/verify-sync-counters.cjs` |
