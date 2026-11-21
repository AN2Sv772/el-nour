-- ============================================================================
-- MIGRATION: Durable webhook event queue for EasyOrders
-- ADDITIVE — upgrades easyorders_webhook_events into a real job queue:
--   acknowledge fast (202) → process in background → retry with backoff
--   → dead-letter after max attempts → manual/automatic retry.
-- ============================================================================

-- Processing lifecycle columns
ALTER TABLE easyorders_webhook_events
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','processed','failed','dead_letter')),
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Stable deduplication identity: EasyOrders does not provide an event ID.
-- Key = event_type + external order id + created_at of the event row batch.
-- Duplicates (same order, same type, within a short window) collapse to one job.
CREATE INDEX IF NOT EXISTS idx_eowe_dedup ON easyorders_webhook_events(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Queue drain index: claim pending events due for processing
CREATE INDEX IF NOT EXISTS idx_eowe_queue ON easyorders_webhook_events(processing_status, next_retry_at)
  WHERE processing_status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS idx_eowe_status ON easyorders_webhook_events(processing_status);

-- Backfill existing rows into the queue (old processed flag → new status)
UPDATE easyorders_webhook_events
SET processing_status = CASE WHEN processed THEN 'processed' ELSE 'pending' END,
    next_retry_at = NOW()
WHERE processing_status = 'pending' AND processed = true;

-- ────────────────────────────────────────────────────────────────────────────
-- Atomic claim function: prevents two workers processing the same event.
-- Uses a conditional UPDATE as an atomic test-and-set (serverless-safe,
-- no in-memory locks).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_webhook_events(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  payload JSONB,
  attempts INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE easyorders_webhook_events e
    SET processing_status = 'processing',
        claimed_at = NOW(),
        claimed_by = p_worker_id,
        attempts = e.attempts + 1
    WHERE e.id IN (
      SELECT c.id
      FROM easyorders_webhook_events c
      WHERE c.processing_status IN ('pending', 'failed')
        AND c.next_retry_at <= NOW()
        AND (c.claimed_at IS NULL OR c.claimed_at < NOW() - INTERVAL '2 minutes')
      ORDER BY c.created_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.id, e.event_type, e.payload, e.attempts
  )
  SELECT cl.id, cl.event_type, cl.payload, cl.attempts FROM claimed cl;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_webhook_events(TEXT, INTEGER) TO service_role;
