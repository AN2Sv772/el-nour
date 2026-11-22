-- =============================================================================
-- Replace the user-controlled role source in the RLS policies
-- =============================================================================
-- WHY
-- ---
-- Eleven tables still decided "is this caller an admin?" by reading
--
--     (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role'
--
-- and that value belongs to the USER. They can set it themselves:
--
--     await supabase.auth.updateUser({ data: { role: 'admin' } })
--
-- The next signed request then carries `user_metadata.role = 'admin'` in the
-- JWT, and every policy that trusted it opened. Verified against the live
-- project: an `employee` account with no database rights anywhere read
-- `ai_config`, `automation_logs`, `easyorders_webhook_events` and
-- `auto_reply_templates` after one `updateUser` call.
--
-- The trustworthy source is the row in `user_profiles` — the same row the
-- application layer reads (`src/lib/supabase/require-role.ts`) — reached
-- through `public.app_has_role()`. That function reads the role through
-- `app_role_rank()`, which is SECURITY DEFINER, so a policy can ask it
-- without recursing into the RLS of the table it is reading. It also
-- returns -1 for an inactive or unknown profile, so a deactivated account
-- loses every policy at once.
--
-- WHAT
-- ---
-- Each policy below keeps the SAME reach it had. Only the source of the
-- role changes. Two policies that were accidentally `WITH CHECK (true)`
-- are tightened as well — they were meant for the server, which writes
-- through the service role and therefore bypasses RLS entirely.
--
-- `user_profiles` is handled in `20260126000000_lock_user_profile_role.sql`.
--
-- EVERY policy is dropped before it is created, so the file can be re-run:
-- `CREATE POLICY` has no `IF NOT EXISTS`, and a second run would abort with
-- `42710 policy ... already exists`.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── ai_config: the AI provider settings (admin only) ─────────────────────────
drop policy if exists "Admins can manage AI config" on public.ai_config;
create policy "Admins can manage AI config"
  on public.ai_config
  for all to authenticated
  using (public.app_has_role('admin'))
  with check (public.app_has_role('admin'));

-- ── auto_reply_templates: the canned replies (manager and above) ─────────────
drop policy if exists "Admins can manage templates" on public.auto_reply_templates;
create policy "Admins can manage templates"
  on public.auto_reply_templates
  for all to authenticated
  using (public.app_has_role('manager'))
  with check (public.app_has_role('manager'));

-- ── automation_logs: the import / webhook audit trail (manager and above) ───
drop policy if exists "Admins can view automation logs" on public.automation_logs;
create policy "Admins can view automation logs"
  on public.automation_logs
  for select to authenticated
  using (public.app_has_role('manager'));

-- ── business_settings: the store's own configuration (admin only) ───────────
drop policy if exists "Admins can manage business settings" on public.business_settings;
create policy "Admins can manage business settings"
  on public.business_settings
  for all to authenticated
  using (public.app_has_role('admin'))
  with check (public.app_has_role('admin'));

-- ── easyorders_sync_job_details ─────────────────────────────────────────────
-- The trustworthy "Admins/Managers can view sync job details" policy stays.
-- The forgeable read policy and the accidental `WITH CHECK (true)` insert
-- policy are replaced by one employee-level insert.
drop policy if exists "Admins can view sync job details" on public.easyorders_sync_job_details;
drop policy if exists "Employees can create sync job details" on public.easyorders_sync_job_details;
drop policy if exists "System can insert sync job details" on public.easyorders_sync_job_details;

create policy "Employees can create sync job details"
  on public.easyorders_sync_job_details
  for insert to authenticated
  with check (public.app_has_role('employee'));

-- ── easyorders_sync_jobs ─────────────────────────────────────────────────────
-- The trustworthy "Admins/Managers can manage sync jobs" policy stays; the
-- forgeable twin is dropped so it cannot widen the reach.
drop policy if exists "Admins can manage sync jobs" on public.easyorders_sync_jobs;
drop policy if exists "Employees can view sync jobs" on public.easyorders_sync_jobs;

create policy "Employees can view sync jobs"
  on public.easyorders_sync_jobs
  for select to authenticated
  using (public.app_has_role('employee'));

-- ── easyorders_webhook_events ────────────────────────────────────────────────
-- The trustworthy "Admins/Managers can view webhook events" policy stays.
-- The forgeable read policy goes, and the two accidental `WITH CHECK (true)`
-- insert policies — one of them is literally named "Service role can insert
-- webhook events" but was created `TO authenticated`, so ANY signed-in
-- account could inject rows into the webhook queue — are replaced by one
-- employee-level insert.
drop policy if exists "Admins can view webhook events" on public.easyorders_webhook_events;
drop policy if exists "Service role can insert webhook events" on public.easyorders_webhook_events;
drop policy if exists "System can insert webhook events" on public.easyorders_webhook_events;
drop policy if exists "Employees can create webhook events" on public.easyorders_webhook_events;

create policy "Employees can create webhook events"
  on public.easyorders_webhook_events
  for insert to authenticated
  with check (public.app_has_role('employee'));

-- ── inventory_movements ──────────────────────────────────────────────────────
-- The `app_*` policies already cover this table with a trustworthy role and
-- with a WIDER reach (employee may insert and update). The two stale
-- policies are dropped; nothing is lost, and the forgeable path is closed.
drop policy if exists "Admins can update inventory movements" on public.inventory_movements;
drop policy if exists "Employees can create inventory movements" on public.inventory_movements;

-- ── order_items ──────────────────────────────────────────────────────────────
-- Same story as inventory_movements: the `app_*` policies already cover it.
drop policy if exists "Employees can create order items" on public.order_items;
drop policy if exists "Managers can update order items" on public.order_items;

-- ── order_status_history ─────────────────────────────────────────────────────
drop policy if exists "Employees can create order status history" on public.order_status_history;
create policy "Employees can create order status history"
  on public.order_status_history
  for insert to authenticated
  with check (public.app_has_role('employee'));

-- ── whatsapp_config: the WhatsApp connection settings (admin only) ───────────
drop policy if exists "Admins can manage WhatsApp config" on public.whatsapp_config;
create policy "Admins can manage WhatsApp config"
  on public.whatsapp_config
  for all to authenticated
  using (public.app_has_role('admin'))
  with check (public.app_has_role('admin'));

-- ── whatsapp_conversations ───────────────────────────────────────────────────
-- The assigned-employee path stays exactly as it was; only the
-- "…or is this caller a manager" half changes source.
drop policy if exists "Assigned employees can update conversations" on public.whatsapp_conversations;
create policy "Assigned employees can update conversations"
  on public.whatsapp_conversations
  for update to authenticated
  using (assigned_to = auth.uid() or public.app_has_role('manager'))
  with check (assigned_to = auth.uid() or public.app_has_role('manager'));

-- ── whatsapp_messages ────────────────────────────────────────────────────────
drop policy if exists "Employees can create messages" on public.whatsapp_messages;
create policy "Employees can create messages"
  on public.whatsapp_messages
  for insert to authenticated
  with check (public.app_has_role('employee'));
