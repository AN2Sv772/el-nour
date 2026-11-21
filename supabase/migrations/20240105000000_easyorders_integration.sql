-- EasyOrders Integration Migration
-- This migration adds tables for EasyOrders integration

-- EasyOrders configuration table
CREATE TABLE easyorders_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key TEXT NOT NULL,
  store_id TEXT,
  store_name TEXT,
  webhook_secret TEXT,
  webhook_url TEXT,
  is_connected BOOLEAN DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed', 'partial')),
  last_sync_error TEXT,
  last_webhook_at TIMESTAMPTZ,
  total_imported_orders INTEGER DEFAULT 0,
  total_updated_orders INTEGER DEFAULT 0,
  total_skipped_orders INTEGER DEFAULT 0,
  sync_cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- EasyOrders sync jobs table
CREATE TABLE easyorders_sync_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES easyorders_config(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('full_import', 'incremental_sync', 'webhook_processing')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  orders_processed INTEGER DEFAULT 0,
  orders_imported INTEGER DEFAULT 0,
  orders_updated INTEGER DEFAULT 0,
  orders_skipped INTEGER DEFAULT 0,
  errors JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_easyorders_sync_jobs_config_id ON easyorders_sync_jobs(config_id);
CREATE INDEX idx_easyorders_sync_jobs_status ON easyorders_sync_jobs(status);
CREATE INDEX idx_easyorders_sync_jobs_created_at ON easyorders_sync_jobs(created_at DESC);

-- EasyOrders webhook events table
CREATE TABLE easyorders_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES easyorders_config(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('order-created', 'order-status-update')),
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_easyorders_webhook_events_config_id ON easyorders_webhook_events(config_id);
CREATE INDEX idx_easyorders_webhook_events_processed ON easyorders_webhook_events(processed);
CREATE INDEX idx_easyorders_webhook_events_created_at ON easyorders_webhook_events(created_at DESC);

-- EasyOrders sync jobs detail table (for tracking individual order processing)
CREATE TABLE easyorders_sync_job_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_job_id UUID NOT NULL REFERENCES easyorders_sync_jobs(id) ON DELETE CASCADE,
  easyorders_order_id TEXT NOT NULL,
  local_order_id UUID REFERENCES orders(id),
  action TEXT NOT NULL CHECK (action IN ('imported', 'updated', 'skipped', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_easyorders_sync_job_details_sync_job_id ON easyorders_sync_job_details(sync_job_id);
CREATE INDEX idx_easyorders_sync_job_details_easyorders_order_id ON easyorders_sync_job_details(easyorders_order_id);

-- Add EasyOrders specific columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS easyorders_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS easyorders_store_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS easyorders_sync_cursor TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS easyorders_last_synced_at TIMESTAMPTZ;

-- Add unique constraint for EasyOrders order ID per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_easyorders_unique 
  ON orders(easyorders_order_id, easyorders_store_id) 
  WHERE easyorders_order_id IS NOT NULL AND easyorders_store_id IS NOT NULL;

-- Add index for EasyOrders queries
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_order_id ON orders(easyorders_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_store_id ON orders(easyorders_store_id);
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_sync_cursor ON orders(easyorders_sync_cursor);

-- Add source value for EasyOrders
-- The 'source' column already exists in orders table

-- Enable RLS on new tables
ALTER TABLE easyorders_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_sync_job_details ENABLE ROW LEVEL SECURITY;

-- RLS Policies for easyorders_config
CREATE POLICY "Admins can manage EasyOrders config" ON easyorders_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Employees can view EasyOrders config" ON easyorders_config
  FOR SELECT TO authenticated
  USING (true);

-- RLS Policies for easyorders_sync_jobs
CREATE POLICY "Admins/Managers can manage sync jobs" ON easyorders_sync_jobs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Employees can view sync jobs" ON easyorders_sync_jobs
  FOR SELECT TO authenticated
  USING (true);

-- RLS Policies for easyorders_webhook_events
CREATE POLICY "Admins/Managers can view webhook events" ON easyorders_webhook_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can insert webhook events" ON easyorders_webhook_events
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- RLS Policies for easyorders_sync_job_details
CREATE POLICY "Admins/Managers can view sync job details" ON easyorders_sync_job_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can insert sync job details" ON easyorders_sync_job_details
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Enable Realtime for sync jobs and webhook events
ALTER PUBLICATION supabase_realtime ADD TABLE easyorders_sync_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE easyorders_webhook_events;

-- Create updated_at triggers
CREATE TRIGGER update_easyorders_config_updated_at 
  BEFORE UPDATE ON easyorders_config 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_easyorders_sync_jobs_updated_at 
  BEFORE UPDATE ON easyorders_sync_jobs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default EasyOrders status mapping into business_settings
-- This will be handled by the application layer

-- Create index for webhook verification
CREATE INDEX IF NOT EXISTS idx_easyorders_config_webhook_secret ON easyorders_config(webhook_secret);

-- Function to clean up old webhook events (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_easyorders_webhook_events()
RETURNS void AS $$
BEGIN
  DELETE FROM easyorders_webhook_events 
  WHERE created_at < NOW() - INTERVAL '30 days'
  AND processed = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create EasyOrders config
CREATE OR REPLACE FUNCTION get_or_create_easyorders_config()
RETURNS TABLE (id UUID, api_key TEXT, is_connected BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT ec.id, ec.api_key, ec.is_connected
  FROM easyorders_config ec
  LIMIT 1;
  
  IF NOT FOUND THEN
    INSERT INTO easyorders_config (api_key, is_connected)
    VALUES ('', FALSE)
    RETURNING id, api_key, is_connected;
  END IF;
END;
$$ LANGUAGE plpgsql;