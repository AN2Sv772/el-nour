-- ═══════════════════════════════════════════════════════════════════════════
-- Report snapshots — the scheduled, immutable record of the business day
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY
--
-- A dashboard shows the numbers NOW. A business owner also needs the
-- numbers AS THEY WERE at the end of each day — otherwise a silent change
-- (a product cost edited, an expense voided, an order re-statused) rewrites
-- history and nobody can see what changed.
--
-- This table stores one snapshot per business day, written by the cron route.
-- It is ADDITIVE: it creates one new table and touches nothing else.
--
-- The snapshot payload keeps the SAME statuses as the live payload — a
-- snapshot of an incomplete day records the incompleteness, not a zero.
--
-- The owner's rules that apply here:
--   - additive only (no destructive migration),
--   - RLS stays on, and the app checks the role as well,
--   - a status vocabulary, never a silent zero.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_type text not null default 'daily',
  -- The Cairo business day the snapshot describes.
  business_date date not null,
  -- The full honest payload (metrics with their statuses, gaps, alerts).
  payload jsonb not null default '{}'::jsonb,
  -- 'complete' | 'partial' | 'failed'
  status text not null default 'complete',
  -- Why it is partial, when it is.
  note text,
  created_at timestamptz not null default now(),
  constraint report_snapshots_report_type_check
    check (report_type in ('daily', 'weekly', 'monthly')),
  constraint report_snapshots_status_check
    check (status in ('complete', 'partial', 'failed')),
  -- One snapshot per (report_type, business_date): the cron is idempotent.
  constraint report_snapshots_unique_day unique (report_type, business_date)
);

create index if not exists report_snapshots_business_date_idx
  on public.report_snapshots (business_date desc);

comment on table public.report_snapshots is
  'Daily immutable snapshots of the business metrics, each keeping the honest status of every number.';

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.report_snapshots enable row level security;

-- The app connects with the service role (which bypasses RLS), so the
-- application MUST check the role itself — see `requireRole`. These policies
-- are the second line of defence for any direct client access.
drop policy if exists "report_snapshots_read_authenticated" on public.report_snapshots;
create policy "report_snapshots_read_authenticated"
  on public.report_snapshots
  for select
  to authenticated
  using (app_has_role(auth.uid(), array['admin', 'manager', 'employee', 'viewer']));

drop policy if exists "report_snapshots_write_admin" on public.report_snapshots;
create policy "report_snapshots_write_admin"
  on public.report_snapshots
  for insert
  to authenticated
  with check (app_has_role(auth.uid(), array['admin', 'manager']));

drop policy if exists "report_snapshots_update_admin" on public.report_snapshots;
create policy "report_snapshots_update_admin"
  on public.report_snapshots
  for update
  to authenticated
  using (app_has_role(auth.uid(), array['admin', 'manager']))
  with check (app_has_role(auth.uid(), array['admin', 'manager']));

-- ── updated_at (the table has no mutable business columns, but keep it
--    consistent with the rest of the schema) ─────────────────────────────────
create or replace function public.set_report_snapshots_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.created_at = now();
  return new;
end;
$$;

drop trigger if exists report_snapshots_set_updated_at on public.report_snapshots;
create trigger report_snapshots_set_updated_at
  before update on public.report_snapshots
  for each row
  execute function public.set_report_snapshots_updated_at();
