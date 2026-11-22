-- =============================================================================
-- Grant the privileges the app needs on the tables the pending migrations
-- created
-- =============================================================================
-- WHY
-- ---
-- `business_brain.sql`, `ai_approvals.sql` and `report_snapshots.sql` created
-- their tables without a single GRANT. On this project the platform's default
-- privileges do NOT reach them, so the app's service-role client got:
--
--     {"code":"42501",
--      "message":"permission denied for table business_profile",
--      "hint":"Grant the required privileges to the current role with:
--              GRANT SELECT ON public.business_profile TO service_role;"}
--
-- Every route that reads those tables would have answered 500 with a
-- permission error instead of the data — and the tables would have looked
-- fine in the dashboard. The tables exist and their RLS is correct; they are
-- simply unreachable.
--
-- WHAT
-- ---
-- The app talks to these tables through the SERVICE role: it checks the
-- caller's role itself (see `src/lib/supabase/require-role.ts`) and the
-- service role bypasses RLS. So `service_role` needs the full DML set.
--
-- `authenticated` gets the same set so that a direct client session is
-- governed by the ROW LEVEL SECURITY policies — which are declared
-- `TO authenticated` — rather than by a missing grant. `anon` deliberately
-- gets nothing: an unauthenticated caller must not reach these tables at
-- all, and the policies would deny it anyway.
--
-- No sequences are involved: every id here is `uuid ... default
-- gen_random_uuid()`, so there is no sequence privilege to grant.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── business brain ───────────────────────────────────────────────────────────
grant select, insert, update, delete on public.business_profile            to authenticated, service_role;
grant select, insert, update, delete on public.business_knowledge          to authenticated, service_role;
grant select, insert, update, delete on public.business_knowledge_sources  to authenticated, service_role;
grant select, insert, update, delete on public.business_goals              to authenticated, service_role;
grant select, insert, update, delete on public.business_rules              to authenticated, service_role;
grant select, insert, update, delete on public.business_brain_questions    to authenticated, service_role;
grant select, insert, update, delete on public.business_brain_runs         to authenticated, service_role;

-- ── ai approvals ─────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.ai_approvals                to authenticated, service_role;
grant select, insert, update, delete on public.ai_execution_logs           to authenticated, service_role;

-- ── report snapshots ─────────────────────────────────────────────────────────
grant select, insert, update, delete on public.report_snapshots            to authenticated, service_role;
