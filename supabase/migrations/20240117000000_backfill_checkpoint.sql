-- ============================================================================
-- MIGRATION: Historical backfill checkpoint (on easyorders_config)
-- Sequential short_id scan: official enumeration path for historical orders
-- (the public API has no orders-list endpoint; short_id is sequential).
-- ============================================================================

ALTER TABLE easyorders_config
  ADD COLUMN IF NOT EXISTS backfill_cursor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_status VARCHAR(20) NOT NULL DEFAULT 'idle'
    CHECK (backfill_status IN ('idle','running','done')),
  ADD COLUMN IF NOT EXISTS backfill_max_id INTEGER,
  ADD COLUMN IF NOT EXISTS backfill_last_error TEXT,
  ADD COLUMN IF NOT EXISTS backfill_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backfill_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backfill_imported INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_skipped INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_failed INTEGER NOT NULL DEFAULT 0;
