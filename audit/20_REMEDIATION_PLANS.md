# Remediation Plans — Execution Ready, NOT Executed

**Status:** PREPARED ONLY. Nothing in this document has been executed.
**Reason:** history rewriting, credential rotation and production database
modifications all require explicit owner approval (see *Approval gate*).

**Project:** El Nour Dashboard · repo `git@github.com:AN2Sv772/el-nour.git` (public)
**DB:** `lyswmlmrlviptprhfiph` · **App:** `https://el-nour-dashboard.vercel.app`

---

## Approval gate

| Plan | Action | Approval required | Owner action |
|---|---|---|---|
| **C** | Apply `20260130000000_lock_public_function_execute.sql` to the live DB | **YES** — production DB write | Owner replies "approve C" |
| **A** | Rewrite git history to purge PII | **YES** — force-push, irreversible | Owner replies "approve A" |
| **B** | Rotate the Supabase service-role key | **YES** — credential rotation | Owner replies "approve B" |

Plans are ordered **C → A → B**. C is the only one that closes a live
exploitable hole; A and B are hygiene.

---

## PLAN C — Apply the function-execute lockdown (the critical fix)

### C.1 What is broken right now

`public` schema functions are exposed through PostgREST, and PostgreSQL grants
EXECUTE to PUBLIC by default. The live project had **22 of 24 public functions
callable by `anon`**, 20 of them `SECURITY DEFINER`. Reproduced against
production with the anonymous key:

| Function | Result | Impact |
|---|---|---|
| `create_order_atomic(...)` | **reached its own body** (raised inside `jsonb_array_elements`, not at a permission check) | Unauthenticated **order creation**. `SECURITY DEFINER`, no internal authz. Inserts into `orders`, `order_items`, `automation_logs`. Requires a valid `customer_id` UUID (`orders.customer_id` is `NOT NULL REFERENCES customers(id)`). |
| `get_or_create_easyorders_config()` | **HTTP 200 + the `api_key` ciphertext** | Unauthenticated read of the encrypted EasyOrders credential; also able to INSERT the config row. 0 application call sites. |
| `cleanup_expired_otp_codes()` | **HTTP 204 (executed)** | Unauthenticated DELETE of expired OTP rows. |
| `cleanup_old_easyorders_webhook_events()` | **HTTP 204 (executed)** | Unauthenticated DELETE of processed webhook events older than 30 days. |
| `current_profile_is_active(uuid)` | **`true` / `null`** | Unauthenticated profile-existence oracle. |

Failing closed already, no action needed: `claim_webhook_events` and
`close_daily_reconciliation` (both invoker functions with no anon table
grant) answered **401 / 42501**.

### C.2 The fix

`supabase/migrations/20260130000000_lock_public_function_execute.sql`

1. `REVOKE ALL` on every `public` function from `PUBLIC`, `anon`, `authenticated`.
2. `GRANT EXECUTE` on every `public` function to `service_role`.
3. `GRANT EXECUTE` to `authenticated` on **exactly** the three functions live
   RLS policies call — `app_has_role(text)`, `app_role_rank()`,
   `current_profile_is_active(uuid)`.
4. `DROP POLICY "Employees can create webhook events"` — the application
   inserts into `easyorders_webhook_events` through the **service client**,
   so the authenticated INSERT grant has no legitimate use.

### C.3 Already validated — dry run against the live DB

The migration was executed inside an explicit transaction that was
**rolled back**, on the production database:

```
V1_counts = anon_exec=0 | auth_exec=3 | svc_exec=24 | total=24
V2_authenticated_still_holds = app_has_role, app_role_rank, current_profile_is_active
V3_leftover_policy = 0
V4_easyorders_config_acl = {postgres=arwdDxtm/postgres,service_role=arwd/postgres}
```

* The functional guard `set local role authenticated; select count(*) from orders;`
  **succeeded** — no `permission denied for function app_has_role`.
* Post-rollback re-probe confirmed production is **unchanged**
  (`current_profile_is_active` → `200 true`, `get_or_create_easyorders_config` → `200`).
* The 8 trigger functions are also revoked; this does not break their
  triggers. Verified empirically: a trigger function revoked from PUBLIC still
  fired (`trigger_fired=true`) for a non-owner role, inside a rolled-back
  transaction. PostgreSQL checks EXECUTE at `CREATE TRIGGER`, not at fire time.

### C.4 Execution (after approval)

```bash
# 1. bundle
node scripts/apply-migrations.mjs --print > /tmp/apply.sql

# 2. apply through the Supabase SQL Editor (paste + Run), or:
#    supabase db push --include-all   (only after `supabase link`)

# 3. verify — expect anon_exec=0, auth_exec=3, svc_exec=24
```

**Post-apply acceptance criteria**

```bash
# every one of these must now fail with 401/403/404 (NOT 200/204)
for fn in get_or_create_easyorders_config current_profile_is_active \
           cleanup_expired_otp_codes cleanup_old_easyorders_webhook_events \
           create_order_atomic; do
  curl -s -o /dev/null -w "$fn %{http_code}\n" -X POST \
    "$SUPABASE_URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
    -H 'Content-Type: application/json' --data '{}'
done

# the app must still work
curl -s -o /dev/null -w "orders %{http_code}\n" "$APP/api/orders" -H "Cookie: $ADMIN_COOKIE"
curl -s -o /dev/null -w "admin-write %{http_code}\n" -X POST "$APP/api/reconciliation" \
     -H "Cookie: $ADMIN_COOKIE" -H 'Content-Type: application/json' -d '{"date":"2026-11-23"}'
```

**Rollback:** `git revert` the migration, or re-run the inverse REVOKEs.
The change is a privilege change only — no data is written, so reverting is
instant and lossless.

**Residual risk (accepted, documented):** `authenticated` keeps EXECUTE on
`current_profile_is_active(uuid)` because a live policy needs it, so an
authenticated user can still ask whether a given UUID has an active profile.
UUIDs are not enumerable and a non-admin cannot read other profiles.
Closing it properly means replacing the policy with a no-argument
`auth.uid()`-based helper — a separate, optional migration.

---

## PLAN A — Purge PII from git history

### A.1 What is actually in the history (measured, not assumed)

The repository has **12 commits** and a **9.46 MiB** object store.
A full `git log --all -p` scan (133 155 patch lines, 126 909 added lines)
found:

| Value class | Distinct values | Commits | Live customer match? |
|---|---|---|---|
| `sb_secret_*` / JWT / private key / AWS key | **0** | — | n/a |
| Stale `EASYORDERS_API_KEY` (23 bytes) | 1 | `fd56af6` (`.env.example`) | **no — proven dead** |
| Stale `EASYORDERS_STORE_ID` | 1 | `fd56af6` (`.env.example`) | no |
| Egyptian mobile numbers | 6 | `af1f6c4` (11 files) | **0 of 6** match the 1 935 live customers |
| Email-shaped values | 24 in HEAD | `af1f6c4`, `1ba898f`, `d5577ea`, `afc5b9d`, `cee5ae0`, `fd56af6`, `52c9b2` | **0 of 24** match live customers |
| Owner/team addresses (`an2s.q.*@gmail.com`) | 3 | many, including HEAD | n/a — the operator's own addresses |

### A.2 The severity has been reduced, and this matters

The one genuine credential in the history — the EasyOrders API key — is
**not** the live credential, and it is **already dead**:

* The live DB value decrypts to a **36-byte** plaintext
  (`easyorders_config.api_key` ciphertext is 133 chars; the `v1:` envelope
  overhead is 61 chars → 36 bytes). The published value is **23 bytes**.
  Different values.
* `GET https://api.easy-orders.net/api/v1/external-apps/products` with the
  published value returns **`Api-Key not valid` (HTTP 400)** — byte-identical
  to the response for a deliberately wrong control key.
* The live key demonstrably authenticates: the audited backfill imported
  **3 live orders** through this integration using the DB key.

**Conclusion: the live EasyOrders key has never been in git.** The exposure
was a stale, already-revoked credential. It was removed from HEAD in commit
`5ff3fae` (pushed, remote head verified). History rewrite is therefore
*hygiene*, not incident response.

The Supabase service-role key was **never** in the repository or its history
(0 exact matches against the live value; `sb_secret_` count = 0 in history;
0 occurrences in any built artefact).

### A.3 The rewrite (only if the owner wants full hygiene)

```bash
# 0. prerequisites
brew install git-filter-repo            # if not installed
git clone --mirror git@github.com:AN2Sv772/el-nour.git /tmp/el-nour-purge.git

# 1. build the replacement file, one line per value:  literal==>REPLACEMENT
#    Values are collected by the scanner, never typed by hand:
python3 /var/.../scan-history.py > /tmp/history-scan.txt   # fingerprints only
#    then derive the literal list with the same regexes and write:
#      <literal>==>REDACTED_PII
#    Suggested replacements:
#      the stale EasyOrders key/store id  ==> your-easyorders-api-key / -store-id
#      the 6 phone numbers                ==> 0100000000N
#      non-owner emails                   ==> redacted@example.invalid

# 2. dry run in the mirror and re-scan the mirror before touching the remote
cd /tmp/el-nour-purge.git
git filter-repo --replace-text ../replace.txt --force
#    re-run the scanner against the mirror; expect 0 hits for every class

# 3. force-push — THIS IS THE IRREVERSIBLE STEP
git push --force --mirror origin
```

### A.4 Risks and irreversibility

* **Force-push rewrites every commit SHA.** All clones must be discarded and
  re-cloned; `git pull` on existing clones will fail hard.
* **Old objects can survive** in GitHub's caches and in anyone's local clone.
  After the push, ask GitHub Support to purge cached views of the old SHAs.
* **The owner/team addresses appear in HEAD**, so a blanket replace-text also
  rewrites the current documentation (the allow-list email in
  `AUTONOMOUS_TASK_STATE.md`, `audit/19_REMEDIATION_LOG.md`,
  `replica/build-log.md`). Decide explicitly whether to purge the operator's
  own addresses; they are already public and are the least sensitive item.
* **Do not purge `REGISTRATION_ALLOWED_EMAILS`'s value from the *live*
  configuration** — it is a Vercel env var, not a repo concern, and removing
  it would re-close registration (it currently correctly permits 3 addresses).
* **Never run `filter-repo` on the working clone**; use the mirror. Keep
  `/tmp/el-nour-purge.git` until the remote is verified clean.

### A.5 Alternative to a force-push

If the owner does not want to rewrite history, the exposure is already
contained: the stale key is dead, the phone numbers and emails match **no**
live customer record, and the only remaining PII in HEAD is the operator's own
three email addresses. In that case, record the decision in
`audit/19_REMEDIATION_LOG.md` and close A as *accepted, mitigated*.

---

## PLAN B — Service-role key rotation

### B.1 Is rotation needed?

**No — not on current evidence.** The service-role key was never exposed:

| Check | Result |
|---|---|
| Exact-match scan of all 12 commits against the live key | **0 occurrences** |
| `sb_secret_*` pattern across the full history | **0** |
| Live key present in any built artefact (`.next/static`, `.next/server`) | **0 files** |
| Any `'use client'` module importing the service client | **0** |
| Key usable as a session cookie against the API | **401** |

The key is a **new-style `sb_secret_` key** (41 chars), which is the
Supabase API-key format that supports **multiple simultaneously active
secret keys** — so a rotation can be genuinely zero-downtime.

### B.2 When rotation *would* be warranted

Rotate if any of these become true:

1. The key ever appears in a Vercel build log, a CI log, a screenshot or a
   support ticket.
2. A personal access token or a machine with repo access is compromised.
3. Supabase's own security advisory names the project.
4. Policy requires periodic rotation regardless of exposure.

### B.3 Zero-downtime rotation procedure (on approval)

```bash
# STEP 1 — create a NEW secret key (do not delete the old one yet)
#   Supabase Dashboard -> Project -> Project Settings -> API Keys
#   -> "Create new secret key"  (label it, e.g. "rotated 2026-11")
#   The new key is shown ONCE. Copy it into a password manager, not a file.

# STEP 2 — add it as a SECOND Vercel env var (no downtime)
vercel env add SUPABASE_SERVICE_ROLE_KEY_NEW production --sensitive
#   paste the new key when prompted

# STEP 3 — deploy code that prefers the new key and falls back to the old
#   src/lib/supabase/service.ts:  key = process.env.SUPABASE_SERVICE_ROLE_KEY_NEW
#                               || process.env.SUPABASE_SERVICE_ROLE_KEY
#   (ship this as its own commit so the fallback can be reverted cleanly)

# STEP 4 — verify the new key works against production
curl -s -o /dev/null -w "service-role read %{http_code}\n" \
  "$SUPABASE_URL/rest/v1/orders?select=id&limit=1" \
  -H "apikey: $NEW_KEY" -H "Authorization: Bearer $NEW_KEY"
#   expect 200
#   then re-run the full production probe set (admin 200 / employee 403 / anon 401)

# STEP 5 — promote: set SUPABASE_SERVICE_ROLE_KEY = <new key> in Vercel,
#   remove SUPABASE_SERVICE_ROLE_KEY_NEW, redeploy, re-verify.

# STEP 6 — only after STEP 5 is verified, REVOKE the old key
#   Supabase Dashboard -> API Keys -> delete the old secret key.
```

**Rollback:** until STEP 6, both keys work — revert the code commit or
re-set the old value and redeploy. After STEP 6 the old key is dead and
cannot be recovered; keep a record of the rotation date.

**Downtime:** none at any step, provided STEP 3's fallback is in place
before STEP 5.

**Blast radius if done wrong:** every server-side write path (105
`createServiceClient()` call sites across 67 files) would fail closed with
"Supabase not configured" — the mock-client fallback in
`src/lib/supabase/service.ts` returns `{ data: null, error: ... }`, so routes
return 500 rather than corrupting data.

---

## Recommended follow-ups (not part of A/B/C)

| # | Item | Severity | Note |
|---|---|---|---|
| 1 | Add `import 'server-only'` to `src/lib/supabase/service.ts` and `src/lib/crypto.ts` | LOW | Requires adding the `server-only` dependency **and** a vitest alias/stub, otherwise 3 test files that import the service client throw at import time. The current state is verified safe (0 client imports, 0 built artefacts contain the key). |
| 2 | Replace `current_profile_is_active(uuid)` with a no-argument `auth.uid()` helper | LOW | Removes the residual authenticated-only profile oracle. |
| 3 | Replace the owner/team e-mail addresses in the public docs with a role alias | LOW | They are already public; this only reduces targeted-phishing value. |
| 4 | `src/lib/supabase/service.ts` returns a silent empty mock when the key is missing | LOW | Reads fail with an error object rather than throwing, so a misconfigured deploy reads as "no data". A throw would be safer. |
| 5 | Drop `get_or_create_easyorders_config()` entirely | LOW | 0 application call sites; REVOKE already makes it unreachable. Dropping removes the latent trap. |
