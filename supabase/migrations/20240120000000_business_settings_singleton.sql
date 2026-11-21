-- ============================================================================
-- MIGRATION: business_settings singleton — fixes duplicate-rows bug
-- Every settings save created a NEW row (upsert w/o conflict target) making
-- GET .single() fail with 500. Keep latest row, enforce exactly one.
-- ============================================================================
DELETE FROM business_settings
WHERE id NOT IN (
  SELECT id FROM business_settings ORDER BY created_at DESC LIMIT 1
);

-- Enforce at most ONE row (constant-expression unique index)
CREATE UNIQUE INDEX IF NOT EXISTS business_settings_singleton_idx
  ON business_settings ((true));
