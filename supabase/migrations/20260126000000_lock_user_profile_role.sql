-- =============================================================================
-- Lock the privilege columns on `user_profiles`
-- =============================================================================
-- WHY
-- ---
-- `user_profiles.role` and `user_profiles.is_active` ARE the authorisation
-- source: every route resolves its role from this row (see
-- `src/lib/supabase/require-role.ts`). The policy in
-- `20240111000000_fix_user_profiles_rls.sql` lets a user update their OWN
-- row with no restriction on the columns, so a signed-in account could write
-- `{"role":"admin"}` to its own row with its own JWT and the public anon
-- key — and every admin-gated route would then open.
--
-- The guard existed in `migrations_fixed/003_rls_policies.sql`, but that is a
-- DIFFERENT set of files: the dated `supabase/migrations/` set that the
-- Supabase CLI actually applies never contained it, so a fresh deployment
-- reproduced the hole.
--
-- WHAT
-- ---
-- 1) A self-update policy that pins `role` and `is_active` to their current
--    values.
-- 2) The column-level REVOKE that makes the privilege columns unwritable.
--
-- The helper functions are SECURITY DEFINER because a policy that reads
-- `user_profiles` from inside a `user_profiles` policy recurses — the very
-- bug the 2024-01-11 migration was written to fix. `app_role_rank()` in
-- `20260120000000_align_rls_with_app_roles.sql` uses the same pattern.
--
-- Role changes go through the service role (the admin API routes, or the
-- Supabase dashboard), which this REVOKE does not affect.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

-- ── 1) The two helpers ───────────────────────────────────────────────────────
create or replace function public.current_profile_role(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select up.role from public.user_profiles up where up.id = p_uid;
$$;

comment on function public.current_profile_role(uuid) is
  'The role stored on the given profile. SECURITY DEFINER so a policy on user_profiles can read it without recursing.';

create or replace function public.current_profile_is_active(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(up.is_active, true) from public.user_profiles up where up.id = p_uid;
$$;

comment on function public.current_profile_is_active(uuid) is
  'Whether the given profile is active. SECURITY DEFINER so a policy on user_profiles can read it without recursing.';

-- ── 2) Drop the permissive self-update policies ──────────────────────────────
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can update own profile (limited)" on public.user_profiles;

-- ── 3) Re-create the self-update policy, pinned to the caller's CURRENT role
--      and active flag. The caller may edit their own name, phone and notes;
--      they may not touch the two columns that carry the authority.
create policy "Users can update own profile (limited)"
  on public.user_profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role is not distinct from public.current_profile_role(auth.uid())
    and is_active is not distinct from public.current_profile_is_active(auth.uid())
  );

-- ── 4) The column-level revoke. Even a policy that allows the row cannot
--      write the two columns that carry the authority.
revoke update (role, is_active) on public.user_profiles from authenticated;

commit;
