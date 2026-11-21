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
