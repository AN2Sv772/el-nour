# Security — Secrets, Encryption and Credential Hygiene

Scope: `.env.local`, `src/lib/crypto.ts`, the `easyorders_config` table, the EasyOrders
API key, the webhook secret and the `CRON_SECRET`.

---

## 1. How secrets are stored

| Secret | Storage | Protection | Status |
|---|---|---|---|
| EasyOrders API key | `easyorders_config.api_key` | AES-256-GCM with `CREDENTIALS_ENCRYPTION_KEY` | PASS (after F-006) |
| EasyOrders webhook secret | `easyorders_config.webhook_secret` | encrypted | PASS |
| `SUPABASE_SERVICE_ROLE_KEY` | environment (Vercel + `.env.local`) | not in the source tree; `.env.local` is excluded from deployment | PASS |
| `CRON_SECRET` | environment | route fails closed when it is absent | PASS (after F-004) |
| `CREDENTIALS_ENCRYPTION_KEY` | environment | single definition | PASS (after F-009) |

## 2. Encryption implementation (`src/lib/crypto.ts`)

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| SEC-01 | cipher | authenticated encryption | AES-256-GCM | PASS |
| SEC-02 | IV | fresh per encryption | a new random IV is generated per call and stored with the ciphertext | PASS |
| SEC-03 | authentication tag | verified on decryption | a tampered ciphertext fails to decrypt | PASS |
| SEC-04 | key derivation | the raw key is used as-is (it is already 64 hex chars) | consistent | PASS |
| SEC-05 | empty / malformed input | rejected | returns an error instead of throwing | PASS |

**Never exposed in this audit:** the API key value, the webhook secret value, the service
role key, the encryption key. Only the key *identifier* (`93a47492-7959-45ab-9a69-a1383d1c2fcc`),
a masked form (`93a4••••••••••••2fcc`) and a fingerprint of the webhook secret were used
as evidence.

## 3. Findings

### F-009 — a duplicated encryption key in `.env.local` → **fixed**

`.env.local` defined `CREDENTIALS_ENCRYPTION_KEY` **twice** (line 55 duplicated an earlier
definition). The later value wins in every dotenv loader, so the application encrypted
with one key and tried to decrypt with another: every encrypted path failed locally with
`Failed to decrypt secret`. The duplicate line was removed and a backup was kept at
`/tmp/env.local.bak-<timestamp>`.

> The local key is **not** the production key. That is intentional: pulling the production
> key into a local file would spread the production secret. The consequence is that
> encrypted routes cannot be exercised locally — they are verified against production
> instead, and the difference is recorded in the evidence.

### F-006 — `DELETE /api/integrations/easyorders` destroyed the credentials → **fixed**

The handler nulled `api_key`, `webhook_secret`, `store_id` and `store_name` without a
confirmation and without keeping a copy. One probe call with an empty body erased the
integration (incident INC-001).

The repaired handler:

1. refuses the request with **400** unless the body contains `{"confirm":"disconnect"}`;
2. **keeps** the encrypted credentials and the store binding;
3. clears only the connection flag (`is_connected = false`);
4. writes an `audit_log` row describing the action.

### F-005 — the column-level `REVOKE` was a no-op → **fixed**

`20260121000000_lock_easyorders_config_privileges.sql` revoked column privileges on
`easyorders_config`, but a table-level `GRANT` from an earlier migration re-granted them,
so the revocation had **no effect**. The migration was rewritten to revoke the table-level
grant as well and to align the RLS policy with the application role model; both migrations
are applied to production and verified.

### F-004 — the order-confirmation cron failed open → **fixed**

`POST /api/integrations/order-confirmation/cron` accepted a request when `CRON_SECRET` was
not configured (fail-open) **and** the middleware blocked the route before it could be
reached (unreachable). It now answers **503** when `CRON_SECRET` is absent, **401** for a
wrong secret, and the middleware exempts exactly that path **for POST only** — the GET
health check stays behind the session.

## 4. Secret hygiene checks

| ID | Check | Result | Status |
|---|---|---|---|
| SH-01 | no secret literal in the source tree | none found (the keys are read from `process.env`) | PASS |
| SH-02 | `.env.local` is not deployed | the Vercel build uses the project's environment; the file is local only | PASS |
| SH-03 | secrets are not written to the application log | no key material in the probe output or the server logs | PASS |
| SH-04 | the API key is never returned to the client | `GET /api/integrations/easyorders` returns `api_key_masked` + `has_api_key` only | PASS |
| SH-05 | the EasyOrders key is not in a URL | it travels in the `Api-Key` header | PASS |
| SH-06 | the webhook secret comparison | the wrong secret is rejected with **401** and a `webhook_rejected` log row (reason `invalid_secret`) | PASS |
| SH-07 | the webhook secret is enforced | confirmed by the self-test: `secretAccepted = true`, `secretEnforced = true` (a wrong secret ⇒ 401) | PASS |
| SH-08 | the service-role key is never exposed to the browser | it is only used in server-side helpers (`src/lib/supabase/service.ts`) | PASS |

## 5. Incident INC-001 — full timeline

| Time (Cairo) | Event |
|---|---|
| 2026-11-20 ~19:45 | probe run 1 sends `DELETE /api/integrations/easyorders` (admin) |
| immediately | the handler nulls the encrypted API key; the ciphertext existed nowhere else |
| +2 min | `GET /api/integrations/easyorders` → `has_api_key=false`, `is_connected=false` |
| ~20:00 | the EasyOrders dashboard is used to re-issue the key; the identifier `93a47492-7959-45ab-9a69-a1383d1c2fcc` is restored through `PUT /api/integrations/easyorders` → **200 "تم حفظ الإعدادات بنجاح"** |
| ~20:02 | `POST …/test` → **200 "تم الاتصال بنجاح"**, `is_connected=true` |
| ~20:05 | `POST …/webhook-config {mode:"self-test"}` → **200**, `endpointLive/secretAccepted/secretEnforced = true`; a wrong secret ⇒ 401 |
| ~20:10 | the harness is hardened: `BLOCKED_MUTATIONS` + `is_blocked()`; 109 mutating probes are now refused before transmission |
| 2026-11-21 | the permanent fix (soft disconnect + confirmation + audit row) is implemented in the working tree |

**Residual exposure:** between the deletion and the restore (roughly 15 minutes) the store
received no automated orders. The backlog was imported automatically once the key was back
(`last_sync_at = 2026-11-20T18:45:16Z`, `total_imported_orders = 19`).

## 6. Residual risks

* The encryption key protects the stored credentials but not the **environment**: whoever
  can read the Vercel environment can decrypt them. Key rotation is therefore a routine
  operation, not an emergency — and the production key was deliberately **not** rotated
  during this audit (rotating it would invalidate every stored secret).
* `audit_log` cannot be deleted (SQLSTATE 42501) — a positive immutability control.
