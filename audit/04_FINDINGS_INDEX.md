# Findings Index

Machine-readable source: `~/security-audit-skill/el-nour-dashboard/run-1/findings.json`
(validator `validate-findings.cjs` → **PASS**, 19 findings: 15 confirmed · 3 needs-validation · 1 rejected).

> **Correction of 2026-11-20 (second measurement pass).** F-011 was rejected in the
> first pass on the reading of `automation_logs`. Re-measured against the authoritative
> delivery marker, that reading was wrong: the `order_created` rows in `automation_logs`
> are written by the **scanner**, not by the webhook handler (which writes a
> `webhook_received` marker — there are **zero** such rows). F-011 is therefore
> **confirmed**, and the former F-012 ("the panel reports a stale `last_webhook_at`")
> is **withdrawn**: `last_webhook_at = 2026-11-06T23:23:58Z` is the true last delivery,
> not a stale value. F-012's slot now carries the **lost-update counter defect**
> (`elnour.easyorders.counter-lost-updates`). F-013, F-017 and F-018 were fixed in the
> working tree and re-verified after this pass.

| ID | Fingerprint | Verdict | Severity | State |
|---|---|---|---|---|
| F-001 | `elnour.api.delete-missing-row-returns-200` | confirmed | low | **fixed** (404 on a missing row) |
| F-002 | `elnour.api.malformed-input-returns-500` | confirmed | medium | **fixed** (400 instead of 500 on 7 endpoints) |
| F-003 | `elnour.api.unbounded-page-size-and-limit` | confirmed | medium | **fixed** (page size and limit bounded) |
| F-004 | `elnour.cron.order-confirmation.fails-open-and-unreachable` | confirmed | medium | **fixed** (fail-closed + public for POST only) |
| F-005 | `elnour.easyorders.column-privilege-revocation-noop` | confirmed | high | **fixed** (migration applied: RLS + column privileges aligned) |
| F-006 | `elnour.easyorders.delete.wipes-credentials` | confirmed | high | **fixed** (soft disconnect + confirmation token + audit row) |
| F-007 | `elnour.easyorders.import-test.writes-production-records` | confirmed | medium | **fixed** (opt-in flag + audit row) |
| F-008 | `elnour.easyorders.worker-routes.viewer-write-access` | confirmed | high | **fixed** (admin required on the four worker routes) |
| F-009 | `elnour.env.duplicate-encryption-key` | confirmed | low | **fixed** (duplicate line removed from `.env.local`) |
| F-010 | `elnour.middleware.rate-limit-store-unbounded` | confirmed | low | **fixed** (10 000-bucket ceiling + expiry sweep) |
| F-011 | `elnour.easyorders.zero-deliveries-since-2026-11-06` | confirmed | medium | **open** — platform-side cause (owner action required) |
| F-012 | `elnour.easyorders.counter-lost-updates` | confirmed | medium | **fixed** (atomic increment + migration prepared) |
| F-013 | `elnour.easyorders.import-path-writes-no-sync-log` | confirmed | low | **fixed** (one sync-log row per scanner run) |
| F-014 | `elnour.api.settings-role-requires-employee` | needs-validation | — | owner decision |
| F-015 | `elnour.easyorders.unknown-webhook-event-dead-letters` | needs-validation | — | owner decision |
| F-016 | `elnour.repo.no-version-control` | needs-validation | — | owner decision |
| F-017 | `elnour.api.export-and-list-use-different-date-boundaries` | confirmed | low | **fixed** (one date engine; 506/506 · 1329/1329 · 43/43) |
| F-018 | `elnour.ui.accessibility-gaps` | confirmed | low | **fixed** (11 routes re-measured: 0 unnamed controls, 0 unlabelled fields) |
| F-019 | `elnour.middleware.rate-limit-double-count` | **rejected** | — | the declared limit is enforced exactly |

## Severity distribution

| Severity | Count | IDs |
|---|---|---|
| high | 3 | F-005, F-006, F-008 |
| medium | 7 | F-002, F-003, F-004, F-007, F-011, F-012, F-014* |
| low | 6 | F-001, F-009, F-010, F-013, F-017, F-018, F-016* |
| — (rejected / needs-validation) | 2 | F-015, F-019 |

\* F-014 and F-016 have no severity rating because their verdict is *needs-validation*.

## The rejected finding, and the one that was wrong the first time

A report that only lists confirmed defects hides the reasoning. The rejection below is
backed by a measurement, not by an opinion — and so is the **correction** above it.

### F-011 — "EasyOrders stopped delivering" → **confirmed** (corrected in the second pass)

**First pass (wrong).** The run concluded that the platform was still delivering,
because `automation_logs` held 2 022 successful `order_created` rows with the newest at
`2026-11-20T18:45:16Z`. That inference was invalid: the **scanner** writes those rows
through the same import routine, so their presence proves that the scanner ran — not
that the platform called the webhook.

**Second pass (measured).** The live webhook handler writes a `webhook_received` marker
into `automation_logs` for every delivery it accepts; the deployed build does exactly
that (the production 405 body matches the worktree handler literally).

| Measurement | Value |
|---|---|
| `automation_logs` rows of type `webhook_received` | **0** |
| `easyorders_webhook_events` rows | 2, both `2026-11-06` |
| `easyorders_config.last_webhook_at` | `2026-11-06T23:23:58Z` |
| `automation_logs` rows of type `order_created` / success | 2 022 (scanner-written) |
| Orders imported more than 24 h after creation | 94 % |
| Import latency, overall median | 708 h (29.5 days) |
| Import latency since 2026-11-19 | median 6.9 h · max 16.1 h · none above 24 h |

The platform has not called the store webhook since **2026-11-06**; every order arrives
through the periodic scanner. The application side is verified correct — it accepts,
authenticates and processes a signed delivery — so the root cause is **external**: the
webhook is not registered / not active in the EasyOrders seller panel. Re-registering it
is an owner action; the code-side observability is delivered (the `webhook_received`
marker and `last_webhook_at` are now measured on every run).

### F-012 (first pass) — "the panel reports a stale `last_webhook_at`" → **withdrawn**

With F-011 corrected, `last_webhook_at = 2026-11-06T23:23:58Z` is the *true* last
delivery — the field is accurate, not stale. The finding was therefore withdrawn and its
slot re-used for the **lost-update counter defect** (`elnour.easyorders.counter-lost-updates`):
`total_imported_orders = 19` against **2 022** successful imports (2 003 lost, 99.1 %),
caused by the read-modify-write in `stampEasyOrdersSync()`.

### F-019 — "the rate limiter double-counts requests" → **rejected**

120 sequential GET requests produced the first HTTP 429 at request **#101**, i.e. exactly
the declared 100 requests/minute. There is no double counting. The real limitations of
that limiter (per-instance state, per-path buckets, an unbounded store) are recorded as
F-010 and in `audit/08_SECURITY_RATE_LIMIT_AND_RESOURCE.md`.

## Remediation state

| State | Count | IDs |
|---|---|---|
| fixed in the working tree (not deployed) | 15 | F-001 … F-010, F-012, F-013, F-017, F-018 |
| open — owner action outside the repository | 1 | F-011 (re-register the webhook in the seller panel) |
| needs an owner decision | 3 | F-014, F-015, F-016 |
| rejected (no action) | 1 | F-019 |

F-012 needs one more step before it is live: the migration
`supabase/migrations/20260122000000_easyorders_atomic_sync_log.sql` has to be applied to
production. The code degrades gracefully until then (it falls back to the previous
read-modify-write), so the deployment order does not matter.

Every confirmed finding carries the full chain — entry point → propagation → sink — plus
the observed result, the exact fix and the re-verification in `findings.json`.
