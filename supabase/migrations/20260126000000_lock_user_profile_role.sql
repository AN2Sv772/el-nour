-- =============================================================================
-- Lock the privilege columns on `user_profiles`
-- =============================================================================
-- WHY
-- ---
-- `user_profiles.role` and `user_profiles.is_active` ARE the authorisation
-- source: every route resolves its role from this row (see
-- `src/lib/supabase/require-role.ts`). The policies in
-- `20240111000000_fix_user_profiles_rls.sql` let a user update their OWN
-- row with no restriction on the columns, so a signed-in account could write
-- `{"role":"admin"}` to its own row with its own JWT and the public anon
-- key — and every admin-gated route would then open.
--
-- That guard existed in `migrations_fixed/003_rls_policies.sql`, but that is a
-- DIFFERENT set of files: the dated `supabase/migrations/` set that the
-- Supabase CLI actually applies never contained it, so a fresh deployment
-- reproduced the hole.
--
-- ── THE THREE THINGS THAT HAD TO BE FIXED TOGETHER ─────────────────────────
--
-- 1) A PERMISSIVE POLICY MAKES A RESTRICTIVE ONE INERT.
--    PostgreSQL OR-s the applicable policies together: a row is writable if
--    ANY policy allows it. So adding a strict self-update policy while
--    leaving the old `"Admins can manage all profiles"` in place changed
--    NOTHING — that policy's WITH CHECK ended in `OR auth.uid() = id`, so a
--    user could always satisfy it by editing their own row. It has to be
--    dropped and re-created, not merely complemented.
--
-- 2) THE OLD POLICY ALSO READ A ROLE THE USER CONTROLS.
--    `(auth.jwt() ->> 'user_metadata')::jsonb ->> 'role'` comes from the
--    user's OWN `user_metadata`, which they can set themselves with
--    `supabase.auth.updateUser({ data: { role: 'admin' } })`. The role has to
--    come from the DATABASE row (`app_role_rank()`), which they cannot edit.
--
-- 3) A COLUMN-LEVEL REVOKE IS A NO-OP WHILE A TABLE-LEVEL GRANT EXISTS.
--    `REVOKE UPDATE (role, is_active)` subtracts a column privilege, but a
--    table-level `UPDATE` grant still permits every column — so the column
--    revoke changed nothing. The table-level UPDATE has to go first, and the
--    harmless columns have to be granted back one by one. This is the same
--    trap the `easyorders_config` fix had to step around in
--    `20260121000000_lock_easyorders_config_privileges.sql`.
--
-- THE ENUM TRAP
-- -------------
-- `user_profiles.role` is the ENUM `user_role`, not text. Comparing it to a
-- text-typed expression is a type error — Postgres has no `user_role = text`
-- operator:
--
--     ERROR: 42883: operator does not exist: user_role = text
--
-- So the role is compared as a RANK, exactly the way `app_role_rank()` in
-- `20260120000000_align_rls_with_app_roles.sql` already does it. The CASE
-- arm literals are `unknown`, so they coerce to whatever type the column
-- has (enum or text) — the policy works either way.
--
-- `app_role_rank()` is SECURITY DEFINER, so reading `user_profiles` from
-- inside a `user_profiles` policy does not recurse — the very bug the
-- 2024-01-11 migration was written to fix. It also returns -1 for an
-- inactive or unknown profile, so an inactive account cannot update its own
-- row at all.
--
-- Role changes go through the service role (the admin API routes, or the
-- Supabase dashboard), which this REVOKE does not affect.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1) The helper that reads the caller's own active flag ───────────────────
-- SECURITY DEFINER so a policy on `user_profiles` can read it without
-- recursing into the RLS of the table it is reading.
--
-- It returns NULL when there is no such profile (the query matches no row),
-- which makes the policy comparison NULL — i.e. DENY. That is the intent:
-- an account with no profile has no authority to change anything.
create or replace function public.current_profile_is_active(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(up.is_active, true)
  from public.user_profiles up
  where up.id = p_uid
  limit 1;
$$;

comment on function public.current_profile_is_active(uuid) is
  'Whether the given profile is active, or NULL when there is no such profile. SECURITY DEFINER so a policy on user_profiles can read it without recursing.';

-- ── 2) Drop every policy that allowed an unrestricted self-write ────────────
-- The third one is the dangerous one: its WITH CHECK ended in
-- `OR auth.uid() = id`, and its role test read the user's own
-- `user_metadata`. Both must go.
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can update own profile (limited)" on public.user_profiles;
drop policy if exists "Admins can manage all profiles" on public.user_profiles;

-- ── 3) The restrictive self-update policy ───────────────────────────────────
-- The caller may edit their own email, full_name, avatar_url and phone; they
-- may not touch the two columns that carry the authority.
--
--      `app_role_rank()` = the rank of the CALLER's current role
--                         (viewer 0, employee 1, manager 2, admin 3, else -1).
--      The CASE          = the rank of the role the caller is TRYING to write.
--      Equal means "unchanged".
create policy "Users can update own profile (limited)"
  on public.user_profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and public.app_role_rank() = case role
      when 'admin' then 3
      when 'manager' then 2
      when 'employee' then 1
      when 'viewer' then 0
      else -1
    end
    and is_active is not distinct from public.current_profile_is_active(auth.uid())
  );

-- ── 4) The management policy, rebuilt on the DATABASE role ──────────────────
-- Same reach as before (an admin or a manager may manage every profile),
-- but the role now comes from the row in `user_profiles` — which the user
-- cannot edit — instead of from the JWT's `user_metadata` — which they can.
create policy "Admins can manage all profiles"
  on public.user_profiles
  for all
  to authenticated
  using (public.app_role_rank() >= 2)
  with check (public.app_role_rank() >= 2);

-- ── 5) Make the column lock real ────────────────────────────────────────────
-- The table-level UPDATE goes first (otherwise it keeps granting every
-- column), and the columns a user may legitimately change are granted back.
-- `role` and `is_active` are deliberately NOT granted: promoting a user is a
-- service-role action (the admin API routes, or the Supabase dashboard).
revoke update on public.user_profiles from authenticated;

grant update (email, full_name, avatar_url, phone) on public.user_profiles to authenticated;
