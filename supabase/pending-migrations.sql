-- El Nour Dashboard — pending migrations (additive only)
-- Project: lyswmlmrlviptprhfiph
-- Generated: 2026-11-22T21:45:56.555Z
-- Safe to run twice: every statement is IF NOT EXISTS / DROP POLICY IF EXISTS.


-- ══════════════════════════════════════════════════════════════
-- 20240110000000_auth_user_profile_trigger.sql
-- ══════════════════════════════════════════════════════════════

-- ============================================================================
-- MIGRATION: Auto-create user_profiles on auth user creation
-- Ensures user profile exists even if API registration fails
-- ============================================================================

-- Function to create user profile on auth user creation
--
-- The account starts with NO authority: role `viewer` and INACTIVE.
--
-- WHY THIS CHANGED
-- ----------------
-- This trigger used to mint role `employee` with `is_active = true`. Every
-- `auth.users` insert — including a stranger who found the public /register
-- link — became a business-WRITE account: create orders, edit prices,
-- adjust stock, and export every customer's name, phone and address.
--
-- `viewer` + inactive is the safe default: the registration route promotes
-- the account to the intended role, and an admin promotes it later. A
-- deactivated account resolves to DENY in `require-role.ts`, so an account
-- that never gets promoted can do nothing at all.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    is_active
  ) VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'viewer',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also ensure the updated_at trigger exists on user_profiles
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ══════════════════════════════════════════════════════════════
-- 20260122000000_easyorders_atomic_sync_log.sql
-- ══════════════════════════════════════════════════════════════

-- =============================================================================
-- Atomic EasyOrders counters + one sync-log row per import run
-- =============================================================================
-- WHY
-- ---
-- 1) LOST COUNTER UPDATES (finding F-012)
--    `stampEasyOrdersSync()` increments `easyorders_config.total_imported_orders`
--    with a read-modify-write:
--
--      SELECT total_imported_orders ...          -- read
--      UPDATE ... SET total_imported_orders = <read> + 1   -- write
--
--    Two import workers that read the same base value overwrite each other,
--    so increments are lost. The live project shows the damage: the panel
--    reports `total_imported_orders = 19` while `automation_logs` contains
--    2 022 successful `order_created` imports (40 of them in the last
--    backfill run alone, whose own counter `backfill_imported = 40` is
--    correct).
--
-- 2) NO AUDIT TRAIL FOR THE SCANNERS (finding F-013)
--    `easyorders_sync_logs` only ever receives rows from the MANUAL sync
--    route (8 rows, all 2026-11-06). The catch-up and backfill scanners —
--    the paths that actually import the store's orders — leave no row at
--    all, so an import that fails halfway is invisible in the table the
--    operator reads.
--
-- HOW
-- ---
-- Two SECURITY DEFINER functions that run inside the database:
--
--   increment_easyorders_counters(...)  -- atomic counter update (per order)
--   record_easyorders_sync_run(...)     -- one sync-log row per run
--
-- IMPORTANT — the two functions never touch the same counters: the counters
-- are incremented PER ORDER by `increment_easyorders_counters`, and the run
-- log deliberately does NOT add the run totals on top of them (that would
-- count every order twice). The log writer only appends the row.
--
-- Both are `SECURITY DEFINER` so the application never needs UPDATE on the
-- table itself, and both are executable by `service_role` only.
--
-- The application code degrades gracefully: if these functions are not
-- present (migration not applied yet) it falls back to the previous
-- read-modify-write + a direct INSERT. Deploy order does not matter.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Allow the scanner run types in `easyorders_sync_logs.sync_type`
-- -----------------------------------------------------------------------------
-- The column is constrained:
--   CHECK (sync_type IN ('manual','webhook','scheduled','retry'))
--
-- The scanners ('backfill' and 'catch-up') are NOT in that list, so their
-- rows would be rejected by the database. The constraint is widened here
-- (it only ADDS values, so no existing row can break).
--
-- The application code degrades gracefully: if this migration has not been
-- applied yet, the helper retries the insert with the pre-existing value
-- 'scheduled', so a run is never left without a log row.
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
    FROM pg_constraint
   WHERE conrelid = 'public.easyorders_sync_logs'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%sync_type%'
   LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.easyorders_sync_logs DROP CONSTRAINT %I', v_constraint);
  END IF;

  ALTER TABLE public.easyorders_sync_logs
    ADD CONSTRAINT easyorders_sync_logs_sync_type_check
    CHECK (sync_type IN ('manual','webhook','scheduled','retry','backfill','catch-up'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- already widened by an earlier run — idempotent
END;
$$;

-- -----------------------------------------------------------------------------
-- 1) Atomic counter increment
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_easyorders_counters(
  p_imported     integer     DEFAULT 0,
  p_updated      integer     DEFAULT 0,
  p_skipped      integer     DEFAULT 0,
  p_last_sync_at timestamptz DEFAULT now(),
  p_status       text        DEFAULT 'success',
  p_error        text        DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.easyorders_config
     SET total_imported_orders = COALESCE(total_imported_orders, 0) + GREATEST(COALESCE(p_imported, 0), 0),
         total_updated_orders  = COALESCE(total_updated_orders, 0)  + GREATEST(COALESCE(p_updated, 0), 0),
         total_skipped_orders = COALESCE(total_skipped_orders, 0) + GREATEST(COALESCE(p_skipped, 0), 0),
         last_sync_at         = COALESCE(p_last_sync_at, now()),
         last_sync_status     = COALESCE(p_status, 'success'),
         last_sync_error      = p_error,
         updated_at           = now()
   WHERE id = (SELECT id FROM public.easyorders_config LIMIT 1);
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) One sync-log row per run
-- -----------------------------------------------------------------------------
-- The row only. It does NOT update `easyorders_config` counters: those are
-- owned by `increment_easyorders_counters`, which runs once per imported
-- order. Adding the run totals here would count every order twice.
-- `p_triggered_by` is declared `text`, not `uuid`, even though the column is
-- a uuid: the application types it as `string | null` and its own test suite
-- passes 'cron'. A uuid parameter would raise `22P02 invalid input syntax
-- for type uuid` and the run would lose its audit row. The value is cast
-- defensively below — a real uuid is stored, anything else becomes NULL.
DROP FUNCTION IF EXISTS public.record_easyorders_sync_run(
  text, text, integer, integer, integer, integer, integer,
  integer, uuid, jsonb, timestamptz, text
);

CREATE OR REPLACE FUNCTION public.record_easyorders_sync_run(
  p_sync_type        text,
  p_status           text,
  p_orders_processed integer     DEFAULT 0,
  p_orders_imported  integer     DEFAULT 0,
  p_orders_updated   integer     DEFAULT 0,
  p_orders_skipped   integer     DEFAULT 0,
  p_orders_failed    integer     DEFAULT 0,
  p_duration_ms      integer     DEFAULT 0,
  p_triggered_by     text        DEFAULT NULL,
  p_errors           jsonb       DEFAULT '[]'::jsonb,
  p_last_sync_at     timestamptz DEFAULT now(),
  p_sync_error       text        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO public.easyorders_sync_logs (
    id, sync_type, status,
    orders_processed, orders_imported, orders_updated,
    orders_skipped, orders_failed,
    errors, duration_ms, triggered_by, created_at
  ) VALUES (
    gen_random_uuid(),
    -- 'scheduled' is valid both before and after the constraint widening
    -- above; 'unknown' would violate the original CHECK constraint.
    COALESCE(p_sync_type, 'scheduled'),
    COALESCE(p_status, 'success'),
    GREATEST(COALESCE(p_orders_processed, 0), 0),
    GREATEST(COALESCE(p_orders_imported, 0), 0),
    GREATEST(COALESCE(p_orders_updated, 0), 0),
    GREATEST(COALESCE(p_orders_skipped, 0), 0),
    GREATEST(COALESCE(p_orders_failed, 0), 0),
    COALESCE(p_errors, '[]'::jsonb),
    GREATEST(COALESCE(p_duration_ms, 0), 0),
    -- Only a syntactically valid uuid reaches the uuid column; anything
    -- else ('cron', 'webhook', ...) is stored as NULL rather than aborting
    -- the whole insert and losing the run's audit row.
    CASE
      WHEN p_triggered_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN p_triggered_by::uuid
      ELSE NULL
    END,
    COALESCE(p_last_sync_at, now())
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- Privileges — only the application's service role may call them
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.increment_easyorders_counters(
  integer, integer, integer, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_easyorders_sync_run(
  text, text, integer, integer, integer, integer, integer,
  integer, text, jsonb, timestamptz, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_easyorders_counters(
  integer, integer, integer, timestamptz, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_easyorders_sync_run(
  text, text, integer, integer, integer, integer, integer,
  integer, text, jsonb, timestamptz, text
) TO service_role;

-- -----------------------------------------------------------------------------
-- Expected result
-- -----------------------------------------------------------------------------
--   has_function_privilege('service_role','public.record_easyorders_sync_run','EXECUTE') => true
--   has_function_privilege('authenticated','public.record_easyorders_sync_run','EXECUTE') => false
--   has_function_privilege('anon','public.increment_easyorders_counters','EXECUTE') => false
--
-- After the next import run:
--   SELECT total_imported_orders FROM easyorders_config;   -- exact, no lost updates
--   SELECT * FROM easyorders_sync_logs ORDER BY created_at DESC LIMIT 1;  -- one row per run
-- -----------------------------------------------------------------------------


-- ══════════════════════════════════════════════════════════════
-- 20260123000000_business_brain.sql
-- ══════════════════════════════════════════════════════════════

-- =============================================================================
-- Business Brain — the store's own memory
-- =============================================================================
-- WHY
-- ---
-- The AI Business OS needs a place where the BUSINESS ITSELF is written down:
-- what the store sells, what the owner refuses to do, what every number means,
-- what the target is, and which of those answers are still missing.
--
-- Without it, every AI answer is a guess dressed as knowledge. With it, every
-- answer can point at a source, and a gap is visible instead of hidden.
--
-- WHAT
-- ---
--   business_profile              one row: who the business is + its operating
--                                 contract (hard constraints, never rules, cash
--                                 floor, ad ceiling, focus)
--   business_knowledge            the knowledge items (facts, rules, goals,
--                                 notes) with their source and their trust state
--   business_knowledge_sources    the provenance of imported/extracted items
--   business_goals                measurable targets, in the same metric keys
--                                 the metrics engine publishes
--   business_rules                natural-language rules the agent must follow
--   business_brain_questions      the question catalogue + the owner's answers
--                                 (the source of the coverage %)
--   business_brain_runs           the audit/study runs (coverage before/after)
--
-- DESIGN RULES
-- ---
-- 1) AN AI-GENERATED ITEM CAN NEVER BE BORN VERIFIED.
--    `source_kind = 'ai_read'` + `status = 'verified'` is rejected by a CHECK
--    constraint. Only the owner (or a confirmed file import) can verify.
-- 2) EVERY ITEM CARRIES ITS SOURCE. `source_kind` says where the knowledge
--    came from: the owner, a file, the store's own data, a decision, an AI
--    read, or a chat.
-- 3) NOTHING IS DELETED BY THE AGENT. "Forget" means `status = 'forgotten'`,
--    so the history stays auditable.
-- 4) RLS IS NEVER DISABLED. Every new table has RLS on and policies that
--    mirror the application roles (viewer / employee / manager / admin).
-- 5) THIS MIGRATION IS ADDITIVE ONLY. It creates tables; it does not touch,
--    drop or alter any existing table.
--
-- HOW TO APPLY (the owner does this, or a psql session)
-- ---
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/20260123000000_business_brain.sql
--
-- The application degrades gracefully: every Brain route answers with an
-- explicit "not configured" state when these tables do not exist yet.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) business_profile — one row, the operating contract
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_profile (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name         text NOT NULL,
  website               text,
  description           text,
  description_ar        text,
  industry              text,
  market                text,
  currency              text NOT NULL DEFAULT 'EGP',
  timezone              text NOT NULL DEFAULT 'Africa/Cairo',
  goals_summary         text,
  sales_channels        text[] NOT NULL DEFAULT '{}',
  connected_platforms   jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_focus         text CHECK (primary_focus IN ('growth', 'profit', 'cash')),
  cash_floor            numeric(12,2),
  max_daily_ad_spend    numeric(12,2),
  hard_constraints      text[] NOT NULL DEFAULT '{}',
  never_rules           text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'incomplete'
                        CHECK (status IN ('not_configured','incomplete','learning','ready','needs_attention','outdated')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_profile IS
  'The store profile and its operating contract. Single row (one store deployment).';
COMMENT ON COLUMN public.business_profile.cash_floor IS
  'Cash below this level is never acceptable — the agent refuses actions that would breach it.';
COMMENT ON COLUMN public.business_profile.max_daily_ad_spend IS
  'Hard ceiling on daily advertising spend.';
COMMENT ON COLUMN public.business_profile.never_rules IS
  'Things this business never does, in the owner''s own words.';
COMMENT ON COLUMN public.business_profile.hard_constraints IS
  'Non-negotiable operating constraints (e.g. no discount below 20%, no shipping to Upper Egypt).';

DROP TRIGGER IF EXISTS update_business_profile_updated_at ON public.business_profile;
CREATE TRIGGER update_business_profile_updated_at
  BEFORE UPDATE ON public.business_profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The store profile is a singleton: at most one row.
CREATE UNIQUE INDEX IF NOT EXISTS business_profile_singleton
  ON public.business_profile ((true));

-- -----------------------------------------------------------------------------
-- 2) business_knowledge — the knowledge items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_knowledge (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic              text NOT NULL,
  title              text NOT NULL,
  body               text NOT NULL,
  kind               text NOT NULL DEFAULT 'fact'
                     CHECK (kind IN ('fact','rule','goal','profile','note','extracted')),
  source_kind        text NOT NULL
                     CHECK (source_kind IN ('owner','file','data','decision','ai_read','chat','import')),
  source_ref         jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence         numeric(3,2) NOT NULL DEFAULT 0.5
                     CHECK (confidence >= 0 AND confidence <= 1),
  status             text NOT NULL DEFAULT 'unverified'
                     CHECK (status IN ('unverified','verified','conflicted','outdated','forgotten')),
  verified_by        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  verified_at        timestamptz,
  last_checked_at    timestamptz,
  check_in_months    integer,
  effective_until    timestamptz,
  created_by         uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- An AI read can inform the business, but it can never certify itself.
  CONSTRAINT business_knowledge_ai_cannot_be_verified
    CHECK (source_kind <> 'ai_read' OR status <> 'verified')
);

COMMENT ON TABLE public.business_knowledge IS
  'What the business knows about itself. Every item carries its source and its trust state.';
COMMENT ON COLUMN public.business_knowledge.status IS
  'unverified | verified | conflicted | outdated | forgotten. Nothing is deleted — forgetting keeps the audit trail.';
COMMENT ON CONSTRAINT business_knowledge_ai_cannot_be_verified ON public.business_knowledge IS
  'An item whose source is an AI read may never be marked verified.';

DROP TRIGGER IF EXISTS update_business_knowledge_updated_at ON public.business_knowledge;
CREATE TRIGGER update_business_knowledge_updated_at
  BEFORE UPDATE ON public.business_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS business_knowledge_topic_idx ON public.business_knowledge (topic);
CREATE INDEX IF NOT EXISTS business_knowledge_status_idx ON public.business_knowledge (status);
CREATE INDEX IF NOT EXISTS business_knowledge_kind_idx   ON public.business_knowledge (kind);

-- -----------------------------------------------------------------------------
-- 3) business_knowledge_sources — provenance for imported / extracted items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_knowledge_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id      uuid NOT NULL REFERENCES public.business_knowledge(id) ON DELETE CASCADE,
  source_kind       text NOT NULL,
  source_ref        text,
  file_name         text,
  extracted_summary text,
  review_status     text NOT NULL DEFAULT 'pending'
                    CHECK (review_status IN ('pending','accepted','rejected')),
  created_by        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_knowledge_sources IS
  'Where an imported knowledge item came from, and whether the owner accepted it.';

CREATE INDEX IF NOT EXISTS business_knowledge_sources_knowledge_idx
  ON public.business_knowledge_sources (knowledge_id);

-- -----------------------------------------------------------------------------
-- 4) business_goals — targets, keyed by the same metric keys as the engine
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key   text NOT NULL,
  target       numeric(14,2) NOT NULL,
  unit         text NOT NULL DEFAULT 'currency',
  period       text NOT NULL DEFAULT 'monthly'
               CHECK (period IN ('daily','weekly','monthly','quarterly','yearly')),
  note         text,
  created_by   uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_goals IS
  'Business targets. metric_key matches the keys published by GET /api/metrics/overview.';

DROP TRIGGER IF EXISTS update_business_goals_updated_at ON public.business_goals;
CREATE TRIGGER update_business_goals_updated_at
  BEFORE UPDATE ON public.business_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS business_goals_metric_key_idx ON public.business_goals (metric_key);

-- -----------------------------------------------------------------------------
-- 5) business_rules — the rules the agent must follow
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL,
  body                 text NOT NULL,
  scope                text NOT NULL DEFAULT 'general',
  priority             integer NOT NULL DEFAULT 100,
  is_active            boolean NOT NULL DEFAULT true,
  effective_from       timestamptz,
  effective_until      timestamptz,
  source_knowledge_id  uuid REFERENCES public.business_knowledge(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_rules IS
  'Natural-language rules that govern what the AI agent may do, in the owner''s words.';

DROP TRIGGER IF EXISTS update_business_rules_updated_at ON public.business_rules;
CREATE TRIGGER update_business_rules_updated_at
  BEFORE UPDATE ON public.business_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS business_rules_active_idx ON public.business_rules (is_active);

-- -----------------------------------------------------------------------------
-- 6) business_brain_questions — the catalogue behind the coverage %
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_brain_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key    text NOT NULL UNIQUE,
  topic           text NOT NULL,
  prompt          text NOT NULL,
  prompt_ar       text NOT NULL,
  why_it_matters  text NOT NULL,
  area            text NOT NULL,
  required        boolean NOT NULL DEFAULT true,
  check_in_months integer,
  answer          text,
  answer_source   text NOT NULL DEFAULT 'owner'
                  CHECK (answer_source IN ('owner','data','ai_read','file')),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','answered','skipped')),
  answered_by     uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  answered_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_brain_questions IS
  'The business questions the Brain asks. Coverage % = answered required questions / answerable required questions.';

DROP TRIGGER IF EXISTS update_business_brain_questions_updated_at ON public.business_brain_questions;
CREATE TRIGGER update_business_brain_questions_updated_at
  BEFORE UPDATE ON public.business_brain_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS business_brain_questions_status_idx ON public.business_brain_questions (status);

-- -----------------------------------------------------------------------------
-- 7) business_brain_runs — the audit / study runs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_brain_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status            text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','succeeded','failed','stopped')),
  step              text,
  areas_learned     text[] NOT NULL DEFAULT '{}',
  facts_kept        integer NOT NULL DEFAULT 0,
  answers_dropped   integer NOT NULL DEFAULT 0,
  coverage_before   numeric(5,2),
  coverage_after    numeric(5,2),
  report            jsonb NOT NULL DEFAULT '{}'::jsonb,
  error             text,
  started_by        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

COMMENT ON TABLE public.business_brain_runs IS
  'One row per Brain audit/study run, with the coverage before and after.';

-- -----------------------------------------------------------------------------
-- 8) Row Level Security
--    Every new table: RLS ON, policies mirroring the application roles.
--    The API layer ALSO checks the role (requireRole), because the routes read
--    through the service-role client which bypasses RLS by design.
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_profile            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_knowledge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_knowledge_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_brain_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_brain_runs         ENABLE ROW LEVEL SECURITY;

-- business_profile: everyone reads, only admin writes.
DROP POLICY IF EXISTS "app_read_business_profile" ON public.business_profile;
CREATE POLICY "app_read_business_profile" ON public.business_profile
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_write_business_profile" ON public.business_profile;
CREATE POLICY "app_write_business_profile" ON public.business_profile
  FOR ALL TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

-- business_knowledge: viewer reads, employee adds/edits, manager forgets.
DROP POLICY IF EXISTS "app_read_business_knowledge" ON public.business_knowledge;
CREATE POLICY "app_read_business_knowledge" ON public.business_knowledge
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_insert_business_knowledge" ON public.business_knowledge;
CREATE POLICY "app_insert_business_knowledge" ON public.business_knowledge
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

DROP POLICY IF EXISTS "app_update_business_knowledge" ON public.business_knowledge;
CREATE POLICY "app_update_business_knowledge" ON public.business_knowledge
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

DROP POLICY IF EXISTS "app_delete_business_knowledge" ON public.business_knowledge;
CREATE POLICY "app_delete_business_knowledge" ON public.business_knowledge
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- business_knowledge_sources: follows its knowledge item.
DROP POLICY IF EXISTS "app_read_business_knowledge_sources" ON public.business_knowledge_sources;
CREATE POLICY "app_read_business_knowledge_sources" ON public.business_knowledge_sources
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_write_business_knowledge_sources" ON public.business_knowledge_sources;
CREATE POLICY "app_write_business_knowledge_sources" ON public.business_knowledge_sources
  FOR ALL TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

-- business_goals: viewer reads, admin writes.
DROP POLICY IF EXISTS "app_read_business_goals" ON public.business_goals;
CREATE POLICY "app_read_business_goals" ON public.business_goals
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_write_business_goals" ON public.business_goals;
CREATE POLICY "app_write_business_goals" ON public.business_goals
  FOR ALL TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

-- business_rules: viewer reads, admin writes.
DROP POLICY IF EXISTS "app_read_business_rules" ON public.business_rules;
CREATE POLICY "app_read_business_rules" ON public.business_rules
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_write_business_rules" ON public.business_rules;
CREATE POLICY "app_write_business_rules" ON public.business_rules
  FOR ALL TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

-- business_brain_questions: viewer reads, admin answers.
DROP POLICY IF EXISTS "app_read_business_brain_questions" ON public.business_brain_questions;
CREATE POLICY "app_read_business_brain_questions" ON public.business_brain_questions
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_write_business_brain_questions" ON public.business_brain_questions;
CREATE POLICY "app_write_business_brain_questions" ON public.business_brain_questions
  FOR ALL TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

-- business_brain_runs: viewer reads, admin starts runs.
DROP POLICY IF EXISTS "app_read_business_brain_runs" ON public.business_brain_runs;
CREATE POLICY "app_read_business_brain_runs" ON public.business_brain_runs
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_write_business_brain_runs" ON public.business_brain_runs;
CREATE POLICY "app_write_business_brain_runs" ON public.business_brain_runs
  FOR ALL TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));


-- ══════════════════════════════════════════════════════════════
-- 20260124000000_ai_approvals.sql
-- ══════════════════════════════════════════════════════════════

-- =============================================================================
-- AI approvals — the owner's signature on every change the assistant proposes
-- =============================================================================
-- WHY
-- ---
-- "Math before AI" is only half the rule. The other half is: the assistant
-- never CHANGES anything by itself. It proposes; the owner approves; the
-- action runs exactly once and is logged.
--
-- The actions that matter most today are the ones that unblock the numbers
-- that are currently withheld — entering a product cost, recording an
-- expense, fixing the shipping fee. Each one is reversible, each one is
-- logged with its before/after state, and each one is idempotent.
--
-- WHAT
-- ---
--   ai_approvals      one row per proposed action: what it does, its impact,
--                     its risk, who asked for it, who approved it, and whether
--                     it has run
--   ai_execution_logs one row per actual execution — the append-only trail of
--                     what the system actually changed
--
-- DESIGN RULES
-- ---
-- 1) IDEMPOTENCY. `idempotency_key` is UNIQUE, so an approval that is
--    double-clicked (or retried by a network) can never run twice.
-- 2) THE BEFORE/AFTER SNAPSHOT IS WRITTEN AT APPROVAL TIME, not at proposal
--    time — so the log shows what really changed.
-- 3) A REJECTED OR EXPIRED APPROVAL CAN NEVER BE EXECUTED.
-- 4) RLS IS NEVER DISABLED. Policies mirror the application roles; the API
--    layer ALSO checks the role (requireRole), because the routes read
--    through the service-role client.
-- 5) THIS MIGRATION IS ADDITIVE ONLY.
--
-- HOW TO APPLY (the owner does this, or a psql session)
-- ---
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/20260124000000_ai_approvals.sql
--
-- The application degrades gracefully: without these tables the assistant
-- still answers questions, it simply cannot propose a change.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ai_approvals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid,
  message_id       uuid,

  action_type      text NOT NULL
                   CHECK (action_type IN (
                     'set_product_cost',
                     'add_expense',
                     'set_business_setting'
                   )),
  title            text NOT NULL,
  description      text NOT NULL,

  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state     jsonb,
  after_state      jsonb,

  -- What the change does to the numbers, in words. The owner reads this
  -- before approving, not after.
  impact_summary   text,

  -- How hard the change is to undo.
  risk_level       text NOT NULL DEFAULT 'low'
                   CHECK (risk_level IN ('notification', 'low', 'medium', 'high')),
  reversible       boolean NOT NULL DEFAULT true,

  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','running','done','failed','expired')),

  -- The key that makes the execution exactly-once.
  idempotency_key  text NOT NULL UNIQUE,

  requested_by     uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  rejected_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  executed_at      timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_approvals IS
  'Actions the assistant proposes. Nothing is applied until an admin approves, and the execution is exactly-once.';
COMMENT ON COLUMN public.ai_approvals.idempotency_key IS
  'UNIQUE — a double click or a retry can never apply the same change twice.';
COMMENT ON COLUMN public.ai_approvals.before_state IS
  'The state of the target row BEFORE the change — written at approval time, not at proposal time.';

DROP TRIGGER IF EXISTS update_ai_approvals_updated_at ON public.ai_approvals;
CREATE TRIGGER update_ai_approvals_updated_at
  BEFORE UPDATE ON public.ai_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS ai_approvals_status_idx ON public.ai_approvals (status);
CREATE INDEX IF NOT EXISTS ai_approvals_action_idx  ON public.ai_approvals (action_type);

-- -----------------------------------------------------------------------------
-- 2) ai_execution_logs — the append-only trail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_execution_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id       uuid NOT NULL REFERENCES public.ai_approvals(id) ON DELETE CASCADE,
  idempotency_key   text NOT NULL UNIQUE,
  action_type       text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state      jsonb,
  after_state       jsonb,
  status            text NOT NULL DEFAULT 'ok'
                    CHECK (status IN ('ok','error','denied')),
  error             text,
  duration_ms       integer,
  executed_by       uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_execution_logs IS
  'Append-only log of what the assistant actually changed. One row per execution — the UNIQUE idempotency key makes a double execution impossible.';

CREATE INDEX IF NOT EXISTS ai_execution_logs_approval_idx ON public.ai_execution_logs (approval_id);

-- -----------------------------------------------------------------------------
-- 3) Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.ai_approvals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_execution_logs ENABLE ROW LEVEL SECURITY;

-- Read: viewer. Propose: employee. Decide: admin.
DROP POLICY IF EXISTS "app_read_ai_approvals" ON public.ai_approvals;
CREATE POLICY "app_read_ai_approvals" ON public.ai_approvals
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_insert_ai_approvals" ON public.ai_approvals;
CREATE POLICY "app_insert_ai_approvals" ON public.ai_approvals
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

DROP POLICY IF EXISTS "app_update_ai_approvals" ON public.ai_approvals;
CREATE POLICY "app_update_ai_approvals" ON public.ai_approvals
  FOR UPDATE TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

DROP POLICY IF EXISTS "app_read_ai_execution_logs" ON public.ai_execution_logs;
CREATE POLICY "app_read_ai_execution_logs" ON public.ai_execution_logs
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

DROP POLICY IF EXISTS "app_insert_ai_execution_logs" ON public.ai_execution_logs;
CREATE POLICY "app_insert_ai_execution_logs" ON public.ai_execution_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('admin'));


-- ══════════════════════════════════════════════════════════════
-- 20260125000000_report_snapshots.sql
-- ══════════════════════════════════════════════════════════════

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
-- The role check is the ONE-ARGUMENT form, `app_has_role(minimum text)`,
-- defined in `20260120000000_align_rls_with_app_roles.sql`. The two-argument
-- form `app_has_role(auth.uid(), text[])` does NOT exist in this schema, so
-- this migration used to FAIL at this line — and because the SQL Editor runs
-- the file as one transaction, the whole table rolled back with it. The
-- minimum role that satisfies each old array is exactly what the one-argument
-- form takes: 'viewer' for the read policy, 'manager' for the write policies.
alter table public.report_snapshots enable row level security;

-- The app connects with the service role (which bypasses RLS), so the
-- application MUST check the role itself — see `requireRole`. These policies
-- are the second line of defence for any direct client access.
drop policy if exists "report_snapshots_read_authenticated" on public.report_snapshots;
create policy "report_snapshots_read_authenticated"
  on public.report_snapshots
  for select
  to authenticated
  using (app_has_role('viewer'));

drop policy if exists "report_snapshots_write_admin" on public.report_snapshots;
create policy "report_snapshots_write_admin"
  on public.report_snapshots
  for insert
  to authenticated
  with check (app_has_role('manager'));

drop policy if exists "report_snapshots_update_admin" on public.report_snapshots;
create policy "report_snapshots_update_admin"
  on public.report_snapshots
  for update
  to authenticated
  using (app_has_role('manager'))
  with check (app_has_role('manager'));

-- ── updated_at ──────────────────────────────────────────────────────────────
-- The table keeps BOTH timestamps. The cron route UPSERTS the row for a
-- business day, so re-running the cron is an UPDATE. The old trigger set
-- `new.created_at = now()` on update, which OVERWROTE the moment the
-- snapshot was first written — destroying the very timestamp that makes a
-- snapshot an immutable record of when the day was closed.
alter table public.report_snapshots
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_report_snapshots_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists report_snapshots_set_updated_at on public.report_snapshots;
create trigger report_snapshots_set_updated_at
  before update on public.report_snapshots
  for each row
  execute function public.set_report_snapshots_updated_at();


-- ══════════════════════════════════════════════════════════════
-- 20260126000000_lock_user_profile_role.sql
-- ══════════════════════════════════════════════════════════════

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
-- The caller may edit their own name, phone and notes; they may not touch
-- the two columns that carry the authority.
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


-- ══════════════════════════════════════════════════════════════
-- 20260127000000_grant_brain_approvals_snapshots.sql
-- ══════════════════════════════════════════════════════════════

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


-- ══════════════════════════════════════════════════════════════
-- 20260128000000_replace_jwt_user_metadata_role_checks.sql
-- ══════════════════════════════════════════════════════════════

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


-- ══════════════════════════════════════════════════════════════
-- 20260129000000_scope_system_insert_policies.sql
-- ══════════════════════════════════════════════════════════════

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
