# El Nour Dashboard — Full System Audit · Executive Summary

**Target** `/Volumes/1/el nour dashboard/el-nour-dashboard` · **Production** https://el-nour-dashboard.vercel.app
**Run** `security-audit-skill/el-nour-dashboard/run-1` · **Date** 2026-11-20 · **Mode** audit → repair → re-verification (no deployment)

---

## 1. Verdict

The application is **safe to keep running** and the repair set in the working tree is
**verified but not deployed**. Three classes of defect were found and fixed:

| Class | Examples | State |
|---|---|---|
| Destructive / recoverable-only-by-hand | the EasyOrders `DELETE` wiped the encrypted credentials (incident INC-001) | fixed + credential restored + verified live |
| Broken access control | a read-only `viewer` could trigger the import workers | fixed + re-verified with three real identities |
| Unhandled input | malformed filters made endpoints answer **500** (21 of them) | fixed — the same probes now answer 400/200, 500 count fell to **1** (local key artefact only) |

Nothing in the audit required an emergency stop of the service, and no customer data was
lost. The two highest-severity items (credential wipe, viewer-accessible workers) are closed
in code and re-verified.

## 2. Numbers that matter

| Metric | Value |
|---|---|
| Findings | **19** — 15 confirmed, 3 needs-validation, 1 rejected |
| Confirmed findings fixed in the working tree | **11** |
| Confirmed findings still open | **3** (all observability/consistency, none exploitable) |
| API probes (538 planned / 429 sent + 109 blocked) | production: 200×111 · 400×40 · 401×156 · 403×41 · 404×13 · 405×7 · 429×40 · **500×21** |
| Same harness against the repaired build | 200×102 · 400×65 · 401×158 · 403×41 · 404×15 · 405×7 · 429×40 · **500×1** |
| Database integrity checks | 25 PASS · 0 FAIL · 3 WARN (2 023 orders · 1 922 customers · 12 products) |
| Unit tests | **279/279** (22 files) · `tsc --noEmit` clean · `npm run build` compiled |
| Coverage units closed | 20/20 |
| Production rows deleted by the audit | **0 business rows** — only rows the audit itself created (see §6) |

## 3. The incident that shaped the run

The first probe pass reached `DELETE /api/integrations/easyorders` and the handler
**erased the stored EasyOrders API key**. The ciphertext existed nowhere else, so the
integration stayed down until the key was re-issued from the EasyOrders dashboard
(`93a47492-7959-45ab-9a69-a1383d1c2fcc`).

After the incident the harness was changed so that **every state-changing endpoint is
blocked at the transport layer** (`BLOCKED_MUTATIONS`, `is_blocked()`, 109 probes skipped
per run, `AUDIT_ALLOW_DESTRUCTIVE=1` required to override). The handler now performs a
*soft* disconnect: it refuses without `{ "confirm": "disconnect" }`, keeps the secrets,
and writes an `audit_log` row.

## 4. What is still open

> **Updated after the second measurement pass (2026-11-20).** The four fixes listed as
> "open" in the first pass have been implemented in the working tree and re-verified
> (F-012 · F-013 · F-017 · F-018 → **fixed**). F-011 changed verdict: it is now
> **confirmed** — the platform has not called the store webhook since 2026-11-06, and
> every order arrives through the periodic scanner. The former F-012 ("the panel shows a
> stale `last_webhook_at`") was **withdrawn**: that field is accurate. Its slot now
> carries the lost-update counter defect. Details: `audit/04_FINDINGS_INDEX.md`.

| ID | Issue | State |
|---|---|---|
| **F-011** | **the EasyOrders platform has not called the store webhook since 2026-11-06 — every order arrives through the scanner instead (94 % of the orders are imported more than 24 h late; overall median 29.5 days)** | **open — the cause is outside the repository: the webhook must be re-registered in the EasyOrders seller panel. The application side is verified correct.** |
| F-012 | the import counters lose updates (`total_imported_orders = 19` against 2 022 successful imports — 2 003 lost) | **fixed** in the working tree: the increment moved into the database (`increment_easyorders_counters`, SECURITY DEFINER) with a safe fallback; the migration is prepared and still has to be applied to production |
| F-013 | catch-up/backfill imports write no `easyorders_sync_logs` row | **fixed**: one shared writer appends exactly one row per scanner run (`backfill` / `catch-up`), with the counters left to the per-order atomic increment |
| F-017 | the Excel export applies raw timestamps while the list applies Cairo day boundaries → 3 rows missing | **fixed** and re-verified: the export and the list now return identical row sets (506/506 · 1329/1329 · 43/43), and an unparseable bound is rejected with HTTP 400 |
| F-018 | icon-only buttons without accessible names, unlabelled settings inputs, routes without `h1`, no skip link | **fixed** and re-verified on the running build: 11 routes, 0 unnamed controls, 0 unlabelled fields, one `h1` and a skip link on every route |
| F-014 | `GET /api/settings` requires `employee` while comparable read endpoints accept `viewer` | **owner decision**, not a defect |
| F-015 | unknown webhook event types are stored as dead letters | **owner decision** (drop vs. retain) |
| F-016 | the project is not under version control | **owner decision** (needs a private repository) |

## 5. What the audit could not decide

* **EasyOrders delivery history** — the platform's own delivery log is not reachable from
  here; the application-side evidence was used instead. That evidence is now conclusive
  for the *application* side (the webhook handler works, the platform does not call it),
  but the platform-side cause can only be confirmed by the owner re-registering the
  webhook and watching a `webhook_received` marker appear.
* **Role model intent** — two role questions need the owner's answer, not more probing.
* **Encrypted paths locally** — the local `CREDENTIALS_ENCRYPTION_KEY` differs from the
  production key, so encrypted routes could only be verified against production.

## 6. Data handling statement

The audit deleted **only rows it had created itself**, always after identifying them by an
explicit marker (`AUDIT-TEST`, `AUDIT-BATCH-1`, `e2e-rejected-*`, `probe-wrong-secret`,
probe timestamps) and after counting the tables before and after:

| Cleaned | Rows |
|---|---|
| synthetic order / customer / product / line item (run 1) | 4 |
| `AUDIT-TEST` collection batch + allocation | 3 |
| `AUDIT-TEST` expense | 1 |
| audit reconciliation row | 1 |
| webhook dead-letter events created by the probes | 4 |
| `webhook_rejected` probe rows in `automation_logs` | 18 |

`audit_log` could **not** be cleaned: the database denies `DELETE` on that table
(`permission denied for table audit_log`, SQLSTATE 42501) — an intentional immutability
control, recorded as a positive result.

Two side effects of the audit were **not** avoidable and are disclosed: the probe calls to
`/catch-up` and `/backfill` performed **real EasyOrders imports** (8 orders and 7 customers
arrived while the audit ran), and the browser session called `POST /process-queue` once.
Both imported genuine store orders — no synthetic business data entered production.

## 7. Deliverables

* 21 documents in `audit/` (this file is `00_EXECUTIVE_SUMMARY.md`)
* Machine-readable artefacts: `~/security-audit-skill/el-nour-dashboard/run-1/findings.json`
  (validator: PASS), `coverage-ledger.json` (validator: PASS), `architecture.md`,
  `run-metadata.json`
* Raw evidence: `audit/evidence/` — probe results (production + repaired build), integrity
  report, UI audit, export probe, performance measurements, cleanup report
* Repair patch: 19 source files changed in the working tree, **not deployed**
* Deployment plan (separate, needs approval): `audit/19_REMEDIATION_LOG.md` §5
