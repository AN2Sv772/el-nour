-- =============================================================================
-- 20260130000000_lock_public_function_execute.sql
-- =============================================================================
-- Closes the PUBLIC function surface on the `public` schema.
--
-- WHY
-- ---
-- PostgreSQL grants EXECUTE on every new function to PUBLIC by default. The
-- `public` schema is exposed through PostgREST, so PUBLIC == "any anonymous
-- HTTP client with the project's publishable key".
--
-- The audit found 22 of the 24 public functions callable by `anon`, 20 of them
-- SECURITY DEFINER. Three of those were exploitable as written:
--
--   1. public.get_or_create_easyorders_config()
--        SECURITY DEFINER, returns the `api_key` column of easyorders_config.
--        Reproduced: POST /rest/v1/rpc/get_or_create_easyorders_config with
--        the anon key returned HTTP 200 and the encrypted credential. It can
--        also INSERT the config row when none exists. The application never
--        calls it (0 call sites in src/).
--
--   2. public.create_order_atomic(...)
--        SECURITY DEFINER, no internal authorization check. Reproduced: the
--        anon key reached the function body (it raised inside its own
--        jsonb_array_elements loop rather than at a permission check). It
--        INSERTs into orders, order_items and automation_logs. The
--        application never calls it (0 call sites in src/).
--
--   3. public.cleanup_expired_otp_codes() and
--      public.cleanup_old_easyorders_webhook_events()
--        SECURITY DEFINER DELETE functions. Reproduced: both returned HTTP
--        204 to the anon key, i.e. they executed.
--
--   4. public.current_profile_is_active(uuid)
--        SECURITY DEFINER profile-existence oracle: a known UUID answered
--        `true`, an unknown one `null`.
--
-- WHAT
-- ---
--   1. REVOKE EXECUTE from PUBLIC, anon and authenticated on EVERY function
--      in the public schema.
--   2. GRANT EXECUTE to service_role on all of them. service_role is the
--      server-side role (BYPASSRLS) used by createServiceClient(); the
--      application calls three of these RPCs through it.
--   3. GRANT EXECUTE to authenticated on ONLY the three functions that live
--      RLS policy expressions call:
--        app_has_role(text), app_role_rank(), current_profile_is_active(uuid)
--      A policy expression is evaluated with the privileges of the role
--      running the query, so without this every authenticated SELECT would
--      fail with "permission denied for function app_has_role". The exact
--      dependency set was read from the live catalog (pg_policies), not
--      guessed: these three are the only functions any live policy calls.
--   4. DROP the "Employees can create webhook events" INSERT policy. The
--      application inserts into easyorders_webhook_events through the
--      service client (webhook route), so the authenticated INSERT grant has
--      no legitimate use; it only let an employee plant arbitrary payloads
--      for the queue to execute through the real import pipeline.
--
-- SAFE FOR TRIGGER FUNCTIONS
-- --------------------------
-- 8 of the 24 functions are trigger functions and are also revoked. That does
-- not break the existing triggers: the EXECUTE privilege is checked when the
-- trigger is CREATED, not when it fires. This was verified empirically on the
-- live project inside a transaction that was rolled back - a trigger function
-- was revoked from PUBLIC and a trigger on a temporary table still fired
-- (`trigger_fired=true`) for a non-owner role.
--
-- RESIDUAL RISK (accepted, documented)
-- ------------------------------------
-- `authenticated` keeps EXECUTE on current_profile_is_active(uuid) because a
-- live policy needs it, so an authenticated user can still ask whether a
-- given UUID has an active profile. UUIDs are not enumerable and a non-admin
-- cannot read other profiles, so this is low impact. Closing it properly
-- means replacing the policy with a no-argument auth.uid()-based helper.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1 + 2. revoke from the public-facing roles, grant back to service_role ─
do $$
declare f record;
begin
  perform set_config('search_path', 'public, pg_catalog', true);

  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ── 3. authenticated keeps exactly the three functions the live policies call ─
do $$
declare f record;
begin
  perform set_config('search_path', 'public, pg_catalog', true);

  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_has_role', 'app_role_rank', 'current_profile_is_active')
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ── 4. drop the unused employee write path into the webhook queue ──────────
drop policy if exists "Employees can create webhook events" on public.easyorders_webhook_events;

-- ── verification ────────────────────────────────────────────────────────────
-- Expected after a successful run:
--   anon_executable_functions         = 0
--   authenticated_executable_functions = 3   (app_has_role, app_role_rank,
--                                             current_profile_is_active)
--   service_role_executable_functions  = 24
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE'))          as anon_executable_functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_executable_functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('service_role', p.oid, 'EXECUTE'))  as service_role_executable_functions,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'easyorders_webhook_events'
      and policyname = 'Employees can create webhook events')        as leftover_employee_insert_policy;
