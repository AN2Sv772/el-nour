-- The easyorders_webhook_events table has NO updated_at column, but an update
-- trigger referencing NEW.updated_at breaks every UPDATE (queue claim, status
-- transitions). Recreate the trigger with a matching column.
ALTER TABLE easyorders_webhook_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DROP TRIGGER IF EXISTS update_easyorders_webhook_events_updated_at ON easyorders_webhook_events;
CREATE TRIGGER update_easyorders_webhook_events_updated_at
  BEFORE UPDATE ON easyorders_webhook_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
