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
