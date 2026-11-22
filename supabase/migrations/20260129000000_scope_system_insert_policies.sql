-- =============================================================================
-- Scope the "System" / "Service" insert policies to the service role
-- =============================================================================
-- WHY
-- ---
-- Three insert policies were created `TO authenticated` with
-- `WITH CHECK (true)`:
--
--     "System inserts audit log"                (audit_log)
--     "Service can insert sync logs"            (easyorders_sync_logs)
--     "Service can insert confirmation events"  (order_confirmation_events)
--
-- The names say "System" and "Service", but the role they were scoped to was
-- `authenticated` — so ANY signed-in account could write rows into them.
--
-- `audit_log` is the audit trail the owner reads to see who changed what, so
-- being able to forge its rows is not a cosmetic problem.
--
-- WHAT
-- ---
-- The application writes all three through `createServiceClient()` — the
-- SERVICE role, which has BYPASSRLS and therefore needs no policy at all
-- (verified: every one of those call sites is a service client). The
-- policies are re-scoped to `service_role`, which keeps the intent visible
-- in the dashboard while closing the `authenticated` path.
--
-- With no policy left for `authenticated`, an INSERT is denied by RLS
-- (PostgreSQL denies when no applicable policy allows the command).
--
-- Idempotent: safe to re-run.
-- =============================================================================

drop policy if exists "System inserts audit log" on public.audit_log;
create policy "System inserts audit log"
  on public.audit_log
  for insert to service_role
  with check (true);

drop policy if exists "Service can insert sync logs" on public.easyorders_sync_logs;
create policy "Service can insert sync logs"
  on public.easyorders_sync_logs
  for insert to service_role
  with check (true);

drop policy if exists "Service can insert confirmation events" on public.order_confirmation_events;
create policy "Service can insert confirmation events"
  on public.order_confirmation_events
  for insert to service_role
  with check (true);
