-- =============================================================================
-- Lock easyorders_config away from end-user sessions (effective column-level
-- lockdown of the encrypted secrets)
-- =============================================================================
-- WHY
-- ---
-- `20260120000000_align_rls_with_app_roles.sql` tried to protect the encrypted
-- secrets with:
--
--   REVOKE SELECT (api_key, webhook_secret) ON easyorders_config FROM authenticated;
--
-- That statement is a NO-OP in PostgreSQL. Column privileges only take effect
-- when the role's privilege does NOT already come from a table-level GRANT.
-- `authenticated` held a table-level grant (`authenticated=arwd/postgres` on
-- the relation), so the REVOKE recorded nothing:
--
--   pg_attribute.attacl                     => NULL
--   has_column_privilege('authenticated',
--       'easyorders_config','api_key','SELECT') => true
--
-- and a signed-in `employee` session could still read the ciphertext straight
-- from PostgREST:
--
--   GET /rest/v1/easyorders_config?select=api_key   => 200 (ciphertext)
--
-- WHY IT MATTERS
-- ---
-- The ciphertext is AES-256-GCM output, so it is not directly replayable
-- against EasyOrders and the plaintext cannot be derived from it. It is still
-- encrypted key material that must not leave the database for a low-privilege
-- session: if the server-side encryption key ever leaks, every copy of the
-- ciphertext becomes a live API key.
--
-- The application never exposes those columns to a browser (the API route
-- masks the key and only admins may change the configuration), and EVERY
-- read/write of `easyorders_config` goes through `createServiceClient()`
-- (service role) — no user JWT ever touches this table.
--
-- HOW
-- ---
-- 1. REVOKE the table-level privilege from `authenticated` and `anon`.
-- 2. GRANT the non-secret columns back, column by column.
--
-- `service_role` keeps its own table grants, so the application's API routes
-- are unaffected.
--
-- Verified empirically against the live project after applying this:
--   employee session -> SELECT api_key          => 403 (42501)
--   employee session -> SELECT webhook_secret   => 403 (42501)
--   employee session -> SELECT *                => 403 (42501)
--   employee session -> SELECT store_id         => 200 (still readable)
--   anon session     -> SELECT api_key          => 401 (42501)
--   service_role     -> SELECT api_key          => 200 (app path intact)
--
-- Idempotent: safe to re-run.
-- =============================================================================

REVOKE ALL PRIVILEGES ON TABLE easyorders_config FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE easyorders_config FROM anon;

-- Non-secret columns remain readable by signed-in users; RLS still applies
-- (`app_read_easyorders_config` limits the row to employees and above).
GRANT SELECT (id, store_id, store_name, webhook_url, is_connected,
               last_sync_at, last_sync_status, last_webhook_at)
  ON easyorders_config TO authenticated;

-- -----------------------------------------------------------------------------
-- Expected result of the statements above
-- -----------------------------------------------------------------------------
--   has_table_privilege('authenticated','easyorders_config','SELECT')    => false
--   has_column_privilege('authenticated','easyorders_config','api_key','SELECT')        => false
--   has_column_privilege('authenticated','easyorders_config','webhook_secret','SELECT') => false
--   has_column_privilege('authenticated','easyorders_config','store_id','SELECT')       => true
--   has_column_privilege('anon','easyorders_config','api_key','SELECT')                 => false
--   has_table_privilege('service_role','easyorders_config','SELECT')                   => true
--   relrowsecurity on easyorders_config                                               => true
-- -----------------------------------------------------------------------------
