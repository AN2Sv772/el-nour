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

DROP POLICY IF EXISTS "app_write_business_profile" ON public.business_profile
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
