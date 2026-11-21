-- ============================================================================
-- MIGRATION: Fix infinite recursion in user_profiles RLS policies
-- The policies were referencing user_profiles within user_profiles policies
-- ============================================================================

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON user_profiles;

-- Create fixed policies that don't cause infinite recursion
-- Use auth.uid() directly instead of querying user_profiles

-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can manage all profiles - use auth.jwt() to check role without querying user_profiles
CREATE POLICY "Admins can manage all profiles" ON user_profiles
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
    OR auth.uid() = id
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
    OR auth.uid() = id
  );

-- Also fix other policies that might have the same issue
-- Customers: fix manager check
DROP POLICY IF EXISTS "Managers can manage customers" ON customers;
CREATE POLICY "Managers can manage customers" ON customers
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- Products
DROP POLICY IF EXISTS "Managers can manage products" ON products;
CREATE POLICY "Managers can manage products" ON products
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- Orders
DROP POLICY IF EXISTS "Employees can create orders" ON orders;
CREATE POLICY "Employees can create orders" ON orders
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

DROP POLICY IF EXISTS "Managers can update orders" ON orders;
CREATE POLICY "Managers can update orders" ON orders
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- Order items
DROP POLICY IF EXISTS "Employees can create order items" ON order_items;
CREATE POLICY "Employees can create order items" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

DROP POLICY IF EXISTS "Managers can update order items" ON order_items;
CREATE POLICY "Managers can update order items" ON order_items
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- WhatsApp messages
DROP POLICY IF EXISTS "Employees can create messages" ON whatsapp_messages;
CREATE POLICY "Employees can create messages" ON whatsapp_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

-- Auto-reply templates
DROP POLICY IF EXISTS "Admins can manage templates" ON auto_reply_templates;
CREATE POLICY "Admins can manage templates" ON auto_reply_templates
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- Automation logs
DROP POLICY IF EXISTS "Admins can view automation logs" ON automation_logs;
CREATE POLICY "Admins can view automation logs" ON automation_logs
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- Inventory movements
DROP POLICY IF EXISTS "Employees can create inventory movements" ON inventory_movements;
CREATE POLICY "Employees can create inventory movements" ON inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

DROP POLICY IF EXISTS "Admins can update inventory movements" ON inventory_movements;
CREATE POLICY "Admins can update inventory movements" ON inventory_movements
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- AI config
DROP POLICY IF EXISTS "Admins can manage AI config" ON ai_config;
CREATE POLICY "Admins can manage AI config" ON ai_config
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- Business settings
DROP POLICY IF EXISTS "Admins can manage business settings" ON business_settings;
CREATE POLICY "Admins can manage business settings" ON business_settings
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- WhatsApp config
DROP POLICY IF EXISTS "Admins can manage WhatsApp config" ON whatsapp_config;
CREATE POLICY "Admins can manage WhatsApp config" ON whatsapp_config
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- EasyOrders config
DROP POLICY IF EXISTS "Admins can manage EasyOrders config" ON easyorders_config;
CREATE POLICY "Admins can manage EasyOrders config" ON easyorders_config
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- Order status history
DROP POLICY IF EXISTS "Employees can create order status history" ON order_status_history;
CREATE POLICY "Employees can create order status history" ON order_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

-- EasyOrders sync jobs
DROP POLICY IF EXISTS "Admins can manage sync jobs" ON easyorders_sync_jobs;
CREATE POLICY "Admins can manage sync jobs" ON easyorders_sync_jobs
  FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS "Employees can view sync jobs" ON easyorders_sync_jobs;
CREATE POLICY "Employees can view sync jobs" ON easyorders_sync_jobs
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

-- EasyOrders webhook events
DROP POLICY IF EXISTS "Admins can view webhook events" ON easyorders_webhook_events;
CREATE POLICY "Admins can view webhook events" ON easyorders_webhook_events
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- EasyOrders sync job details
DROP POLICY IF EXISTS "Admins can view sync job details" ON easyorders_sync_job_details;
CREATE POLICY "Admins can view sync job details" ON easyorders_sync_job_details
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS "Employees can create sync job details" ON easyorders_sync_job_details;
CREATE POLICY "Employees can create sync job details" ON easyorders_sync_job_details
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager', 'employee')
  );

-- WhatsApp conversations
DROP POLICY IF EXISTS "Assigned employees can update conversations" ON whatsapp_conversations;
CREATE POLICY "Assigned employees can update conversations" ON whatsapp_conversations
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid() OR
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  )
  WITH CHECK (
    assigned_to = auth.uid() OR
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' IN ('admin', 'manager')
  );

-- Notifications
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Saved filters
DROP POLICY IF EXISTS "Users can manage own filters" ON saved_filters;
CREATE POLICY "Users can manage own filters" ON saved_filters
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Export jobs
DROP POLICY IF EXISTS "Users can view own export jobs" ON export_jobs;
CREATE POLICY "Users can view own export jobs" ON export_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create export jobs" ON export_jobs;
CREATE POLICY "Users can create export jobs" ON export_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Import jobs
DROP POLICY IF EXISTS "Users can view own import jobs" ON import_jobs;
CREATE POLICY "Users can view own import jobs" ON import_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create import jobs" ON import_jobs;
CREATE POLICY "Users can create import jobs" ON import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
