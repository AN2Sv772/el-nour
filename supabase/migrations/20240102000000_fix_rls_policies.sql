-- Security hardening migration for RLS policies
-- This migration replaces the overly permissive RLS policies with proper role-based access control

-- First, drop the overly permissive policies
DROP POLICY IF EXISTS "Enable all for authenticated users" ON customers;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON products;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON orders;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON order_items;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON whatsapp_conversations;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON whatsapp_messages;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON auto_reply_templates;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON automation_logs;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON inventory_movements;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON user_profiles;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON order_status_history;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON notifications;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON saved_filters;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON export_jobs;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON import_jobs;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ai_config;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON business_settings;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON whatsapp_config;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON easyorders_config;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON easyorders_sync_jobs;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON easyorders_webhook_events;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON easyorders_sync_job_details;

-- Create role-based RLS policies

-- User profiles: users can only see their own profile, admins can see all
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can manage all profiles" ON user_profiles
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

-- Customers: authenticated users can view, only managers/admins can modify
CREATE POLICY "Authenticated users can view customers" ON customers
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Managers can manage customers" ON customers
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

-- Products: authenticated users can view, managers/admins can manage
CREATE POLICY "Authenticated users can view products" ON products
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Managers can manage products" ON products
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

-- Orders: authenticated users can view, employees can create, managers can update
CREATE POLICY "Authenticated users can view orders" ON orders
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Employees can create orders" ON orders
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

CREATE POLICY "Managers can update orders" ON orders
  FOR UPDATE TO authenticated
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

-- Order items: similar to orders
CREATE POLICY "Authenticated users can view order items" ON order_items
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Employees can create order items" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

CREATE POLICY "Managers can update order items" ON order_items
  FOR UPDATE TO authenticated
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

-- WhatsApp conversations: all authenticated can view, assigned employees can update
CREATE POLICY "Authenticated users can view conversations" ON whatsapp_conversations
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Assigned employees can update conversations" ON whatsapp_conversations
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    assigned_to = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- WhatsApp messages: similar
CREATE POLICY "Authenticated users can view messages" ON whatsapp_messages
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Employees can create messages" ON whatsapp_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- Auto-reply templates: view for all, manage for admins/managers
CREATE POLICY "Authenticated users can view templates" ON auto_reply_templates
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage templates" ON auto_reply_templates
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

-- Automation logs: only admins/managers can view
CREATE POLICY "Admins can view automation logs" ON automation_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- Inventory movements: view for all, insert for employees, update for admins
CREATE POLICY "Authenticated users can view inventory movements" ON inventory_movements
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Employees can create inventory movements" ON inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

CREATE POLICY "Admins can update inventory movements" ON inventory_movements
  FOR UPDATE TO authenticated
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

-- Notifications: users can only view their own
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Saved filters: users can manage their own
CREATE POLICY "Users can manage own filters" ON saved_filters
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Export jobs: users can view their own
CREATE POLICY "Users can view own export jobs" ON export_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create export jobs" ON export_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Import jobs: users can view their own
CREATE POLICY "Users can view own import jobs" ON import_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create import jobs" ON import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- System settings: only admins
CREATE POLICY "Admins can manage AI config" ON ai_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage business settings" ON business_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage WhatsApp config" ON whatsapp_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage EasyOrders config" ON easyorders_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

-- Order status history: view for all, insert for employees
CREATE POLICY "Authenticated users can view order status history" ON order_status_history
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Employees can create order status history" ON order_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- EasyOrders sync jobs: view for admins/managers
CREATE POLICY "Admins can manage sync jobs" ON easyorders_sync_jobs
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
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- EasyOrders webhook events: view for admins/managers
CREATE POLICY "Admins can view webhook events" ON easyorders_webhook_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- EasyOrders sync job details: view for admins/managers
CREATE POLICY "Admins can view sync job details" ON easyorders_sync_job_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Employees can create sync job details" ON easyorders_sync_job_details
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- EasyOrders webhook events: system can insert
CREATE POLICY "System can insert webhook events" ON easyorders_webhook_events
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- EasyOrders sync job details: system can insert
CREATE POLICY "System can insert sync job details" ON easyorders_sync_job_details
  FOR INSERT TO authenticated
  WITH CHECK (true);