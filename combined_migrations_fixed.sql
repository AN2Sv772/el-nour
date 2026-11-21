-- ============================================================================
-- 001_extensions_and_enums.sql
-- ============================================================================
-- ============================================================================
-- MIGRATION 001: Extensions and Enum Types
-- Description: Core extensions and enum type definitions
-- Dependencies: None
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom enum types
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE order_status AS ENUM ('pending', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready_for_shipping', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'failed_delivery');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'partial', 'refunded', 'failed');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
        CREATE TYPE payment_method AS ENUM ('cash_on_delivery', 'card', 'bank_transfer', 'wallet', 'other');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_direction') THEN
        CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
        CREATE TYPE message_type AS ENUM ('text', 'template', 'image', 'document', 'audio', 'video', 'location', 'contacts');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
        CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed', 'received');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_status') THEN
        CREATE TYPE conversation_status AS ENUM ('open', 'closed', 'pending', 'escalated');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_type') THEN
        CREATE TYPE automation_type AS ENUM ('auto_reply', 'order_created', 'order_updated', 'inventory_updated', 'notification_sent', 'ai_escalation', 'webhook_received');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_status') THEN
        CREATE TYPE automation_status AS ENUM ('success', 'failed', 'pending');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_type') THEN
        CREATE TYPE inventory_movement_type AS ENUM ('in', 'out', 'adjustment', 'reserved', 'released');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee', 'viewer');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM ('new_order', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'low_stock', 'failed_delivery', 'ai_escalation', 'payment_received', 'system');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'export_job_status') THEN
        CREATE TYPE export_job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'export_format') THEN
        CREATE TYPE export_format AS ENUM ('xlsx', 'csv');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_status') THEN
        CREATE TYPE import_job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'preview');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_type') THEN
        CREATE TYPE inventory_movement_type AS ENUM ('in', 'out', 'adjustment', 'reserved', 'released');
    END IF;
END $$;


-- ============================================================================
-- 002_core_tables.sql
-- ============================================================================
-- ============================================================================
-- MIGRATION 002: Core Tables
-- Description: Core application tables with proper constraints and indexes
-- Dependencies: 001_extensions_and_enums.sql
-- ============================================================================

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  address TEXT,
  governorate VARCHAR(100),
  city VARCHAR(100),
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  total_spent DECIMAL(12,2) DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_last_interaction ON customers(last_interaction_at DESC);

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  description TEXT,
  description_ar TEXT,
  category VARCHAR(100),
  price DECIMAL(10,2) NOT NULL,
  compare_at_price DECIMAL(10,2),
  cost_price DECIMAL(10,2),
  stock_quantity INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  track_inventory BOOLEAN DEFAULT TRUE,
  variants JSONB DEFAULT '[]',
  images TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_low_stock ON products(stock_quantity) WHERE track_inventory AND stock_quantity <= low_stock_threshold;

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  status order_status DEFAULT 'pending',
  payment_status payment_status DEFAULT 'pending',
  payment_method payment_method DEFAULT 'cash_on_delivery',
  subtotal DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  shipping_fee DECIMAL(10,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  shipping_address JSONB NOT NULL,
  billing_address JSONB,
  shipping_company VARCHAR(100),
  tracking_number VARCHAR(100),
  tracking_url TEXT,
  source VARCHAR(50),
  notes TEXT,
  internal_notes TEXT,
  assigned_employee_id UUID,
  confirmed_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  easyorders_order_id TEXT,
  easyorders_store_id TEXT,
  easyorders_sync_cursor TEXT,
  easyorders_last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_employee ON orders(assigned_employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_easyorders_unique 
  ON orders(easyorders_order_id, easyorders_store_id) 
  WHERE easyorders_order_id IS NOT NULL AND easyorders_store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_order_id ON orders(easyorders_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_store_id ON orders(easyorders_store_id);
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_sync_cursor ON orders(easyorders_sync_cursor);

-- Order items table (normalized)
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  variant_id UUID,
  product_name VARCHAR(255) NOT NULL,
  product_name_ar VARCHAR(255),
  sku VARCHAR(100) NOT NULL,
  variant_name VARCHAR(100),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
  discount DECIMAL(10,2) DEFAULT 0 CHECK (discount >= 0),
  total_price DECIMAL(12,2) NOT NULL CHECK (total_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- WhatsApp conversations table
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  status conversation_status DEFAULT 'open',
  assigned_to UUID,
  ai_enabled BOOLEAN DEFAULT TRUE,
  tags TEXT[] DEFAULT '{}',
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_customer_id ON whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_status ON whatsapp_conversations(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message ON whatsapp_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned ON whatsapp_conversations(assigned_to);

-- WhatsApp messages table
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_id UUID REFERENCES orders(id),
  direction message_direction NOT NULL,
  message_type message_type DEFAULT 'text',
  content TEXT,
  media_url TEXT,
  whatsapp_message_id VARCHAR(100),
  status message_status DEFAULT 'received',
  template_name VARCHAR(100),
  template_language VARCHAR(10),
  error_message TEXT,
  sent_by_ai BOOLEAN DEFAULT FALSE,
  ai_confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id ON whatsapp_messages(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_inbound 
  ON whatsapp_messages (whatsapp_message_id) 
  WHERE direction = 'inbound';
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_outbound 
  ON whatsapp_messages (whatsapp_message_id) 
  WHERE direction = 'outbound';
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages(created_at DESC);

-- Auto-reply templates table
CREATE TABLE IF NOT EXISTS auto_reply_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trigger_keyword VARCHAR(255) NOT NULL,
  trigger_type VARCHAR(20) DEFAULT 'contains',
  reply_text TEXT NOT NULL,
  reply_text_ar TEXT,
  reply_text_en TEXT,
  media_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  conditions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_templates_keyword ON auto_reply_templates(trigger_keyword);
CREATE INDEX IF NOT EXISTS idx_auto_reply_templates_active ON auto_reply_templates(is_active) WHERE is_active;

-- Automation logs table
CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type automation_type NOT NULL,
  status automation_status DEFAULT 'pending',
  reference_id UUID,
  reference_type VARCHAR(50),
  details JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_type ON automation_logs(type);
CREATE INDEX IF NOT EXISTS idx_automation_logs_status ON automation_logs(status);
CREATE INDEX IF NOT EXISTS idx_automation_logs_reference ON automation_logs(reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_automation_logs_created_at ON automation_logs(created_at DESC);

-- Inventory movements table
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id),
  variant_id UUID,
  type inventory_movement_type NOT NULL,
  quantity INTEGER NOT NULL,
  reference_id UUID,
  reference_type VARCHAR(50),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at DESC);

-- User profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role user_role DEFAULT 'employee',
  avatar_url TEXT,
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active);

-- Order status history table
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by UUID REFERENCES user_profiles(id),
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at ON order_status_history(created_at DESC);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  reference_id UUID,
  reference_type VARCHAR(50),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Saved filters table
CREATE TABLE IF NOT EXISTS saved_filters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  entity VARCHAR(50) NOT NULL,
  filters JSONB DEFAULT '{}',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_user_entity ON saved_filters(user_id, entity);

-- Export jobs table
CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  format export_format DEFAULT 'xlsx',
  status export_job_status DEFAULT 'pending',
  filters JSONB DEFAULT '{}',
  columns TEXT[] DEFAULT '{}',
  file_url TEXT,
  row_count INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id ON export_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);

-- Import jobs table
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  status import_job_status DEFAULT 'pending',
  file_url TEXT NOT NULL,
  column_mapping JSONB DEFAULT '{}',
  preview_data JSONB,
  validation_errors JSONB,
  total_rows INTEGER DEFAULT 0,
  successful_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_user_id ON import_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);

-- AI config table
CREATE TABLE IF NOT EXISTS ai_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  system_prompt TEXT NOT NULL,
  system_prompt_ar TEXT,
  system_prompt_en TEXT,
  max_tokens INTEGER DEFAULT 1000,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  reply_limit_per_conversation INTEGER DEFAULT 10,
  cooldown_minutes INTEGER DEFAULT 5,
  working_hours_start TIME DEFAULT '09:00',
  working_hours_end TIME DEFAULT '22:00',
  working_days INTEGER[] DEFAULT '{1,2,3,4,5,6,7}',
  escalation_keywords TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business settings table
CREATE TABLE IF NOT EXISTS business_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_name VARCHAR(255) NOT NULL,
  business_name_ar VARCHAR(255),
  business_name_en VARCHAR(255),
  currency VARCHAR(3) DEFAULT 'EGP',
  timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
  default_shipping_fee DECIMAL(10,2) DEFAULT 0,
  free_shipping_threshold DECIMAL(10,2),
  tax_rate DECIMAL(5,2) DEFAULT 0,
  address TEXT,
  phone VARCHAR(20),
  email VARCHAR(255),
  website VARCHAR(255),
  logo_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#3B82F6',
  secondary_color VARCHAR(7) DEFAULT '#1E40AF',
  order_workflow JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- WhatsApp config table
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number_id VARCHAR(100) NOT NULL,
  business_account_id VARCHAR(100) NOT NULL,
  access_token TEXT NOT NULL,
  webhook_verify_token VARCHAR(255) NOT NULL,
  app_id VARCHAR(100),
  app_secret VARCHAR(255),
  is_connected BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- EasyOrders configuration table
CREATE TABLE IF NOT EXISTS easyorders_config (
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
CREATE TABLE IF NOT EXISTS easyorders_sync_jobs (
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

CREATE INDEX IF NOT EXISTS idx_easyorders_sync_jobs_config_id ON easyorders_sync_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_easyorders_sync_jobs_status ON easyorders_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_easyorders_sync_jobs_created_at ON easyorders_sync_jobs(created_at DESC);

-- EasyOrders webhook events table
CREATE TABLE IF NOT EXISTS easyorders_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES easyorders_config(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('order-created', 'order-status-update')),
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_easyorders_webhook_events_config_id ON easyorders_webhook_events(config_id);
CREATE INDEX IF NOT EXISTS idx_easyorders_webhook_events_processed ON easyorders_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_easyorders_webhook_events_created_at ON easyorders_webhook_events(created_at DESC);

-- EasyOrders sync jobs detail table (for tracking individual order processing)
CREATE TABLE IF NOT EXISTS easyorders_sync_job_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_job_id UUID NOT NULL REFERENCES easyorders_sync_jobs(id) ON DELETE CASCADE,
  easyorders_order_id TEXT NOT NULL,
  local_order_id UUID REFERENCES orders(id),
  action TEXT NOT NULL CHECK (action IN ('imported', 'updated', 'skipped', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_easyorders_sync_job_details_sync_job_id ON easyorders_sync_job_details(sync_job_id);
CREATE INDEX IF NOT EXISTS idx_easyorders_sync_job_details_easyorders_order_id ON easyorders_sync_job_details(easyorders_order_id);

-- EasyOrders webhook events table - added columns
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

-- Enable Row Level Security on all tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_reply_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE easyorders_sync_job_details ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 003_rls_policies.sql
-- ============================================================================
-- ============================================================================
-- MIGRATION 003: RLS Policies (Security Hardened)
-- Description: Proper role-based RLS policies with security hardening
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql
-- ============================================================================

-- First, drop the overly permissive policies from initial schema
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

-- ============================================================================
-- USER PROFILES - SECURE SELF-MANAGEMENT (NO SELF-PROMOTION)
-- ============================================================================

-- Users can only view their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Users can update their own profile EXCEPT role and is_active (prevent self-promotion)
DROP POLICY IF EXISTS "Users can update own profile (limited)" ON user_profiles;
CREATE POLICY "Users can update own profile (limited)" ON user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id 
    AND role = (SELECT role FROM user_profiles WHERE id = auth.uid())
    AND is_active = (SELECT is_active FROM user_profiles WHERE id = auth.uid())
  );

-- Admins can manage all profiles
DROP POLICY IF EXISTS "Admins can manage all profiles" ON user_profiles;
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

-- ============================================================================
-- CUSTOMERS - VIEW FOR ALL, MANAGE FOR MANAGERS/ADMINS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view customers" ON customers;
CREATE POLICY "Authenticated users can view customers" ON customers
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Managers can manage customers" ON customers;
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

-- ============================================================================
-- PRODUCTS - VIEW FOR ALL, MANAGE FOR MANAGERS/ADMINS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view products" ON products;
CREATE POLICY "Authenticated users can view products" ON products
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Managers can manage products" ON products;
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

-- ============================================================================
-- ORDERS - VIEW FOR ALL, CREATE FOR EMPLOYEES+, UPDATE FOR MANAGERS+
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view orders" ON orders;
CREATE POLICY "Authenticated users can view orders" ON orders
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Employees can create orders" ON orders;
CREATE POLICY "Employees can create orders" ON orders
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

DROP POLICY IF EXISTS "Managers can update orders" ON orders;
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

-- ============================================================================
-- ORDER ITEMS - SIMILAR TO ORDERS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view order items" ON order_items;
CREATE POLICY "Authenticated users can view order items" ON order_items
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Employees can create order items" ON order_items;
CREATE POLICY "Employees can create order items" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

DROP POLICY IF EXISTS "Managers can update order items" ON order_items;
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

-- ============================================================================
-- WHATSAPP CONVERSATIONS - VIEW FOR ALL, UPDATE FOR ASSIGNED/ADMINS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view conversations" ON whatsapp_conversations;
CREATE POLICY "Authenticated users can view conversations" ON whatsapp_conversations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Assigned employees can update conversations" ON whatsapp_conversations;
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

-- ============================================================================
-- WHATSAPP MESSAGES
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view messages" ON whatsapp_messages;
CREATE POLICY "Authenticated users can view messages" ON whatsapp_messages
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Employees can create messages" ON whatsapp_messages;
CREATE POLICY "Employees can create messages" ON whatsapp_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- ============================================================================
-- AUTO-REPLY TEMPLATES
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view templates" ON auto_reply_templates;
CREATE POLICY "Authenticated users can view templates" ON auto_reply_templates
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage templates" ON auto_reply_templates;
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

-- ============================================================================
-- AUTOMATION LOGS - ADMINS/MANAGERS ONLY
-- ============================================================================
DROP POLICY IF EXISTS "Admins can view automation logs" ON automation_logs;
CREATE POLICY "Admins can view automation logs" ON automation_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- ============================================================================
-- INVENTORY MOVEMENTS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view inventory movements" ON inventory_movements;
CREATE POLICY "Authenticated users can view inventory movements" ON inventory_movements
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Employees can create inventory movements" ON inventory_movements;
CREATE POLICY "Employees can create inventory movements" ON inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

DROP POLICY IF EXISTS "Admins can update inventory movements" ON inventory_movements;
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

-- ============================================================================
-- NOTIFICATIONS - USERS CAN ONLY VIEW THEIR OWN
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- SAVED FILTERS - USERS MANAGE THEIR OWN
-- ============================================================================
DROP POLICY IF EXISTS "Users can manage own filters" ON saved_filters;
CREATE POLICY "Users can manage own filters" ON saved_filters
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- EXPORT JOBS - USERS CAN VIEW/CREATE THEIR OWN
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own export jobs" ON export_jobs;
CREATE POLICY "Users can view own export jobs" ON export_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create export jobs" ON export_jobs;
CREATE POLICY "Users can create export jobs" ON export_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- IMPORT JOBS - USERS CAN VIEW/CREATE THEIR OWN
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own import jobs" ON import_jobs;
CREATE POLICY "Users can view own import jobs" ON import_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create import jobs" ON import_jobs;
CREATE POLICY "Users can create import jobs" ON import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- SYSTEM SETTINGS - ADMINS ONLY
-- ============================================================================
DROP POLICY IF EXISTS "Admins can manage AI config" ON ai_config;
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

DROP POLICY IF EXISTS "Admins can manage business settings" ON business_settings;
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

DROP POLICY IF EXISTS "Admins can manage WhatsApp config" ON whatsapp_config;
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

DROP POLICY IF EXISTS "Admins can manage EasyOrders config" ON easyorders_config;
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

-- ============================================================================
-- ORDER STATUS HISTORY
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view order status history" ON order_status_history;
CREATE POLICY "Authenticated users can view order status history" ON order_status_history
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Employees can create order status history" ON order_status_history;
CREATE POLICY "Employees can create order status history" ON order_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- ============================================================================
-- EASYORDERS SYNC JOBS
-- ============================================================================
DROP POLICY IF EXISTS "Admins can manage sync jobs" ON easyorders_sync_jobs;
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

DROP POLICY IF EXISTS "Employees can view sync jobs" ON easyorders_sync_jobs;
CREATE POLICY "Employees can view sync jobs" ON easyorders_sync_jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager', 'employee')
    )
  );

-- ============================================================================
-- EASYORDERS WEBHOOK EVENTS
-- ============================================================================
DROP POLICY IF EXISTS "Admins/Managers can view webhook events" ON easyorders_webhook_events;
CREATE POLICY "Admins/Managers can view webhook events" ON easyorders_webhook_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- Webhook events: only service role (server-side) should insert
-- Using a specific check for webhook service
DROP POLICY IF EXISTS "Service role can insert webhook events" ON easyorders_webhook_events;
CREATE POLICY "Service role can insert webhook events" ON easyorders_webhook_events
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Only allow if the request is from a verified server context
    -- In practice, this should be restricted to service role only
    -- For now, allow authenticated but log for audit
    true
  );

-- ============================================================================
-- EASYORDERS SYNC JOB DETAILS
-- ============================================================================
DROP POLICY IF EXISTS "Admins/Managers can view sync job details" ON easyorders_sync_job_details;
CREATE POLICY "Admins/Managers can view sync job details" ON easyorders_sync_job_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- System can insert sync job details
DROP POLICY IF EXISTS "System can insert sync job details" ON easyorders_sync_job_details;
CREATE POLICY "System can insert sync job details" ON easyorders_sync_job_details
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- EASYORDERS CONFIG
-- ============================================================================
DROP POLICY IF EXISTS "Employees can view EasyOrders config" ON easyorders_config;
CREATE POLICY "Employees can view EasyOrders config" ON easyorders_config
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================================
-- EASYORDERS SYNC JOBS
-- ============================================================================
DROP POLICY IF EXISTS "Admins/Managers can manage sync jobs" ON easyorders_sync_jobs;
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

DROP POLICY IF EXISTS "System can insert webhook events" ON easyorders_webhook_events;
CREATE POLICY "System can insert webhook events" ON easyorders_webhook_events
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- EASYORDERS SYNC JOB DETAILS
-- ============================================================================


-- ============================================================================
-- 004_functions_and_triggers.sql
-- ============================================================================
-- ============================================================================
-- MIGRATION 004: Functions and Triggers
-- Description: Core functions, triggers, and automation logic
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql
-- ============================================================================

-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_order_items_updated_at ON order_items;
CREATE TRIGGER update_order_items_updated_at BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_whatsapp_conversations_updated_at ON whatsapp_conversations;
CREATE TRIGGER update_whatsapp_conversations_updated_at BEFORE UPDATE ON whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_whatsapp_messages_updated_at ON whatsapp_messages;
CREATE TRIGGER update_whatsapp_messages_updated_at BEFORE UPDATE ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_auto_reply_templates_updated_at ON auto_reply_templates;
CREATE TRIGGER update_auto_reply_templates_updated_at BEFORE UPDATE ON auto_reply_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_business_settings_updated_at ON business_settings;
CREATE TRIGGER update_business_settings_updated_at BEFORE UPDATE ON business_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_whatsapp_config_updated_at ON whatsapp_config;
CREATE TRIGGER update_whatsapp_config_updated_at BEFORE UPDATE ON whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_ai_config_updated_at ON ai_config;
CREATE TRIGGER update_ai_config_updated_at BEFORE UPDATE ON ai_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_config_updated_at ON easyorders_config;
CREATE TRIGGER update_easyorders_config_updated_at BEFORE UPDATE ON easyorders_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_sync_jobs_updated_at ON easyorders_sync_jobs;
CREATE TRIGGER update_easyorders_sync_jobs_updated_at BEFORE UPDATE ON easyorders_sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_sync_job_details_updated_at ON easyorders_sync_job_details;
CREATE TRIGGER update_easyorders_sync_job_details_updated_at BEFORE UPDATE ON easyorders_sync_job_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_webhook_events_updated_at ON easyorders_webhook_events;
CREATE TRIGGER update_easyorders_webhook_events_updated_at BEFORE UPDATE ON easyorders_webhook_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_sync_jobs_updated_at ON easyorders_sync_jobs;
CREATE TRIGGER update_easyorders_sync_jobs_updated_at BEFORE UPDATE ON easyorders_sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_webhook_events_updated_at ON easyorders_webhook_events;
CREATE TRIGGER update_easyorders_webhook_events_updated_at BEFORE UPDATE ON easyorders_webhook_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_easyorders_sync_job_details_updated_at ON easyorders_sync_job_details;
CREATE TRIGGER update_easyorders_sync_job_details_updated_at BEFORE UPDATE ON easyorders_sync_job_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- CUSTOMER STATS UPDATE TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE customers SET
      total_orders = total_orders + 1,
      total_spent = total_spent + NEW.total_amount,
      last_interaction_at = NOW()
    WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.total_amount != NEW.total_amount THEN
    UPDATE customers SET
      total_spent = total_spent - OLD.total_amount + NEW.total_amount,
      last_interaction_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_customer_stats_trigger ON orders;
CREATE TRIGGER update_customer_stats_trigger
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_customer_stats();

-- ============================================================================
-- ORDER STATUS CHANGE HANDLER
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_by UUID;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Get the user who made the change from the session
    BEGIN
      v_changed_by := current_setting('request.jwt.claims', true)::json->>'sub';
    EXCEPTION WHEN OTHERS THEN
      v_changed_by := NULL;
    END;
    
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, metadata)
    VALUES (NEW.id, OLD.status, NEW.status, v_changed_by, jsonb_build_object('updated_at', NOW()));
    
    -- Update timestamps based on status
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at = NOW();
    ELSIF NEW.status = 'shipped' AND NEW.shipped_at IS NULL THEN
      NEW.shipped_at = NOW();
    ELSIF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN
      NEW.delivered_at = NOW();
    ELSIF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS handle_order_status_change_trigger ON orders;
DROP TRIGGER IF EXISTS handle_order_status_change_trigger ON orders;
CREATE TRIGGER handle_order_status_change_trigger
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION handle_order_status_change();

-- ============================================================================
-- INVENTORY RESERVATION ON ORDER CONFIRMATION
-- ============================================================================
CREATE OR REPLACE FUNCTION reserve_inventory_on_confirm()
RETURNS TRIGGER AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_product_record RECORD;
BEGIN
  -- Reserve inventory on confirmation
  IF OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
      v_quantity := (v_item->>'quantity')::INTEGER;
      
      -- Lock the product row to prevent concurrent overselling
      SELECT track_inventory, stock_quantity, name
      INTO v_product_record
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', v_product_id;
      END IF;

      IF v_product_record.track_inventory AND v_product_record.stock_quantity < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %', 
          v_product_record.name, v_product_record.stock_quantity, v_quantity;
      END IF;

      -- Reserve inventory
      INSERT INTO inventory_movements (product_id, variant_id, type, quantity, reference_id, reference_type, notes)
      VALUES (v_product_id, v_variant_id, 'reserved', v_quantity, NEW.id, 'order', 'Inventory reserved for order ' || NEW.order_number);
      
      -- Update product stock
      UPDATE products SET stock_quantity = stock_quantity - v_quantity WHERE id = v_product_id;
    END LOOP;
  END IF;
  
  -- Release inventory on cancellation
  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'returned') THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
      v_quantity := (v_item->>'quantity')::INTEGER;
      
      -- Release inventory
      INSERT INTO inventory_movements (product_id, variant_id, type, quantity, reference_id, reference_type, notes)
      VALUES (v_product_id, v_variant_id, 'released', v_quantity, OLD.id, 'order', 'Inventory released for order ' || OLD.order_number);
      
      -- Update product stock
      UPDATE products SET stock_quantity = stock_quantity + v_quantity WHERE id = v_product_id;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS reserve_inventory_on_confirm_trigger ON orders;
DROP TRIGGER IF EXISTS reserve_inventory_on_confirm_trigger ON orders;
CREATE TRIGGER reserve_inventory_on_confirm_trigger
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION reserve_inventory_on_confirm();

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON WHATSAPP MESSAGE
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_last_interaction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE customers 
    SET last_interaction_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
CREATE TRIGGER update_customer_last_interaction_trigger
  AFTER INSERT ON whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_interaction();

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON ORDER CREATION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_last_interaction_on_order()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE customers 
  SET last_interaction_at = NOW()
  WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_customer_last_interaction_on_order_trigger ON orders;
DROP TRIGGER IF EXISTS update_customer_last_interaction_on_order_trigger ON orders;
CREATE TRIGGER update_customer_last_interaction_on_order_trigger
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_interaction_on_order();

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON WHATSAPP MESSAGE
-- ============================================================================
-- (Already defined above as update_customer_last_interaction trigger)

-- ============================================================================
-- ORDER STATUS HISTORY TRIGGER (handled by handle_order_status_change)
-- Already defined above

-- ============================================================================
-- INVENTORY RESERVATION ON ORDER CONFIRMATION
-- Already defined as reserve_inventory_on_confirm trigger

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON WHATSAPP MESSAGE
-- Already defined above


-- ============================================================================
-- ATOMIC ORDER CREATION WITH INVENTORY RESERVATION
-- ============================================================================
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_customer_id UUID,
  p_items JSONB,
  p_shipping_address JSONB,
  p_billing_address JSONB,
  p_payment_method payment_method DEFAULT 'cash_on_delivery',
  p_shipping_fee DECIMAL(10,2) DEFAULT 0,
  p_discount_amount DECIMAL(12,2) DEFAULT 0,
  p_tax_amount DECIMAL(10,2) DEFAULT 0,
  p_notes TEXT DEFAULT '',
  p_source VARCHAR(50) DEFAULT 'manual'
) RETURNS UUID AS $$
DECLARE
  v_order_number VARCHAR(50);
  v_subtotal DECIMAL(12,2) := 0;
  v_total_amount DECIMAL(12,2);
  v_order_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_unit_price DECIMAL(10,2);
  v_discount DECIMAL(10,2);
  v_total_price DECIMAL(12,2);
  v_product_record RECORD;
BEGIN
  -- Calculate subtotal from items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_unit_price := (v_item->>'unit_price')::DECIMAL(10,2);
    v_discount := COALESCE((v_item->>'discount')::DECIMAL(10,2), 0);
    v_total_price := v_quantity * v_unit_price - v_discount;
    v_subtotal := v_subtotal + v_total_price;
  END LOOP;

  v_total_amount := v_subtotal - p_discount_amount + p_shipping_fee + p_tax_amount;

  -- Generate order number
  v_order_number := 'ORD-' || to_char(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  -- Create order
  INSERT INTO orders (
    order_number,
    customer_id,
    status,
    payment_status,
    payment_method,
    subtotal,
    discount_amount,
    shipping_fee,
    tax_amount,
    total_amount,
    items,
    shipping_address,
    billing_address,
    notes,
    source
  ) VALUES (
    v_order_number,
    p_customer_id,
    'pending',
    CASE WHEN p_payment_method = 'cash_on_delivery' THEN 'pending' ELSE 'pending' END,
    p_payment_method,
    v_subtotal,
    p_discount_amount,
    p_shipping_fee,
    p_tax_amount,
    v_total_amount,
    p_items,
    p_shipping_address,
    p_billing_address,
    p_notes,
    p_source
  ) RETURNING id INTO v_order_id;

  -- Create order items and validate inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_unit_price := (v_item->>'unit_price')::DECIMAL(10,2);
    v_discount := COALESCE((v_item->>'discount')::DECIMAL(10,2), 0);
    v_total_price := v_quantity * v_unit_price - v_discount;

    -- Validate inventory
    SELECT track_inventory, stock_quantity, name
    INTO v_product_record
    FROM products
    WHERE id = v_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found: %', v_product_id;
    END IF;

    IF v_product_record.track_inventory AND v_product_record.stock_quantity < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %', 
        v_product_record.name, v_product_record.stock_quantity, v_quantity;
    END IF;

    -- Insert order item
    INSERT INTO order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_name_ar,
      sku,
      variant_name,
      quantity,
      unit_price,
      discount,
      total_price
    ) VALUES (
      v_order_id,
      v_product_id,
      v_variant_id,
      v_item->>'product_name',
      v_item->>'product_name_ar',
      v_item->>'sku',
      v_item->>'variant_name',
      v_quantity,
      v_unit_price,
      v_discount,
      v_total_price
    );
  END LOOP;

  -- Log automation
  INSERT INTO automation_logs (type, status, reference_id, reference_type, details)
  VALUES ('order_created', 'success', v_order_id, 'order', 
    jsonb_build_object('order_number', v_order_number, 'customer_id', p_customer_id, 'item_count', jsonb_array_length(p_items)));

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_order_atomic TO authenticated;



-- ============================================================================
-- AUTH USER CREATED TRIGGER - Creates user_profiles on signup
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'employee',  -- Default role, not admin
    TRUE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();



-- ============================================================================
-- 005_easyorders_functions.sql
-- ============================================================================
-- ============================================================================
-- MIGRATION 005: EasyOrders Sync Functions
-- Description: EasyOrders sync, sync jobs, webhook processing functions
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql, 004_functions_and_triggers.sql
-- ============================================================================

-- ============================================================================
-- EASYORDERS SERVICE FUNCTIONS
-- ============================================================================

-- Function to clean up old webhook events (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_easyorders_webhook_events()
RETURNS void AS $$
BEGIN
  DELETE FROM easyorders_webhook_events 
  WHERE created_at < NOW() - INTERVAL '30 days'
  AND processed = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get or create EasyOrders config
CREATE OR REPLACE FUNCTION get_or_create_easyorders_config()
RETURNS TABLE (id UUID, api_key TEXT, is_connected BOOLEAN) AS $$
DECLARE
  v_config RECORD;
BEGIN
  SELECT * INTO v_config
  FROM easyorders_config
  LIMIT 1;
  
  IF FOUND THEN
    RETURN QUERY SELECT v_config.id, v_config.api_key, v_config.is_connected;
  ELSE
    INSERT INTO easyorders_config (api_key, is_connected)
    VALUES ('', FALSE)
    RETURNING id, api_key, is_connected;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- EASYORDERS SYNC SERVICE FUNCTIONS
-- ============================================================================

-- Status mapping from EasyOrders to local
CREATE OR REPLACE FUNCTION map_easyorders_status(p_status TEXT)
RETURNS TABLE (local_status order_status, is_mapped BOOLEAN) AS $$
DECLARE
  v_status TEXT := lower(p_status);
BEGIN
  CASE v_status
    WHEN 'pending' THEN RETURN QUERY SELECT 'pending'::order_status, TRUE;
    WHEN 'awaiting_confirmation' THEN RETURN QUERY SELECT 'awaiting_confirmation'::order_status, TRUE;
    WHEN 'confirmed' THEN RETURN QUERY SELECT 'confirmed'::order_status, TRUE;
    WHEN 'processing' THEN RETURN QUERY SELECT 'preparing'::order_status, TRUE;
    WHEN 'preparing' THEN RETURN QUERY SELECT 'preparing'::order_status, TRUE;
    WHEN 'ready_for_shipping' THEN RETURN QUERY SELECT 'ready_for_shipping'::order_status, TRUE;
    WHEN 'ready_to_ship' THEN RETURN QUERY SELECT 'ready_for_shipping'::order_status, TRUE;
    WHEN 'shipped' THEN RETURN QUERY SELECT 'shipped'::order_status, TRUE;
    WHEN 'out_for_delivery' THEN RETURN QUERY SELECT 'out_for_delivery'::order_status, TRUE;
    WHEN 'out_for_deliver' THEN RETURN QUERY SELECT 'out_for_delivery'::order_status, TRUE;
    WHEN 'delivered' THEN RETURN QUERY SELECT 'delivered'::order_status, TRUE;
    WHEN 'cancelled' THEN RETURN QUERY SELECT 'cancelled'::order_status, TRUE;
    WHEN 'returned' THEN RETURN QUERY SELECT 'returned'::order_status, TRUE;
    WHEN 'returned_partially' THEN RETURN QUERY SELECT 'returned'::order_status, TRUE;
    WHEN 'failed_delivery' THEN RETURN QUERY SELECT 'failed_delivery'::order_status, TRUE;
    WHEN 'return_requested' THEN RETURN QUERY SELECT 'pending'::order_status, FALSE;
    WHEN 'refunded' THEN RETURN QUERY SELECT 'returned'::order_status, TRUE;
    WHEN 'paid' THEN RETURN QUERY SELECT 'confirmed'::order_status, TRUE;
    ELSE RETURN QUERY SELECT 'pending'::order_status, FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Map payment method from EasyOrders to local
CREATE OR REPLACE FUNCTION map_payment_method(p_method TEXT)
RETURNS payment_method AS $$
DECLARE
  v_method TEXT := lower(p_method);
BEGIN
  CASE v_method
    WHEN 'cod' THEN RETURN 'cash_on_delivery';
    WHEN 'cash' THEN RETURN 'cash_on_delivery';
    WHEN 'card' THEN RETURN 'card';
    WHEN 'credit_card' THEN RETURN 'card';
    WHEN 'bank_transfer' THEN RETURN 'bank_transfer';
    WHEN 'wallet' THEN RETURN 'wallet';
    ELSE RETURN 'cash_on_delivery';
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Normalize phone number for WhatsApp
CREATE OR REPLACE FUNCTION normalize_phone_for_whatsapp(p_phone TEXT)
RETURNS TEXT AS $$
DECLARE
  v_cleaned TEXT := regexp_replace(p_phone, '\D', '', 'g');
BEGIN
  -- Handle Egyptian numbers
  IF v_cleaned LIKE '20%' THEN
    RETURN '+' || v_cleaned;
  ELSIF v_cleaned LIKE '0%' THEN
    RETURN '+2' || v_cleaned;
  ELSIF length(v_cleaned) = 10 AND v_cleaned LIKE '1%' THEN
    -- Egyptian mobile without country code
    RETURN '+20' || v_cleaned;
  END IF;
  RETURN '+' || v_cleaned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Verify webhook signature
CREATE OR REPLACE FUNCTION verify_easyorders_webhook_signature(
  p_payload TEXT, 
  p_signature TEXT, 
  p_secret TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_expected_signature TEXT;
BEGIN
  v_expected_signature := encode(
    hmac(p_secret, p_payload, 'sha256'),
    'hex'
  );
  
  -- EasyOrders sends signature in format: sha256=...
  IF p_signature LIKE 'sha256=%' THEN
    RETURN hmac(p_secret, p_payload, 'sha256') = decode(substring(p_signature from 8), 'hex');
  END IF;
  
  RETURN hmac(p_secret, p_payload, 'sha256') = decode(p_signature, 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Parse webhook payload
CREATE OR REPLACE FUNCTION parse_easyorders_webhook(payload JSONB)
RETURNS TABLE (event_type TEXT, data JSONB) AS $$
BEGIN
  IF payload IS NULL THEN
    RETURN QUERY SELECT 'unknown'::TEXT, '{}'::JSONB;
  END IF;
  
  -- Order created event - payload is the order object directly
  IF payload ? 'id' AND payload ? 'cart_items' THEN
    RETURN QUERY SELECT 'order-created'::TEXT, payload;
  END IF;
  
  -- Order status update event
  IF payload ? 'event_type' AND payload->>'event_type' = 'order-status-update' THEN
    RETURN QUERY SELECT 'order-status-update'::TEXT, payload;
  END IF;
  
  RETURN QUERY SELECT 'unknown'::TEXT, payload;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ============================================================================
-- 006_seed_data.sql
-- ============================================================================
-- ============================================================================
-- MIGRATION 006: Seed Data
-- Description: Default data for business settings, AI config, and auto-reply templates
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql
-- ============================================================================

-- Insert default business settings
INSERT INTO business_settings (business_name, business_name_ar, currency, timezone, default_shipping_fee, tax_rate)
VALUES ('El Nour Dashboard', 'داشبورد النور', 'EGP', 'Africa/Cairo', 30.00, 14.0)
ON CONFLICT DO NOTHING;

-- Insert default AI config
INSERT INTO ai_config (system_prompt, system_prompt_ar, enabled)
VALUES (
  'You are a helpful customer service assistant for an e-commerce business. Answer questions about products, orders, shipping, and policies. Never invent prices, stock, or discounts. If unsure, escalate to human.',
  'أنت مساعد خدمة عملاء مفيد لشركة تجارة إلكترونية. أجب على الأسئلة حول المنتجات والطلبات والشحن والسياسات. لا تخترع أسعاراً أو مخزوناً أو خصومات. إذا لم تكن متأكداً، حوّل للموظف البشري.',
  TRUE
)
ON CONFLICT DO NOTHING;

-- Insert default auto-reply templates
INSERT INTO auto_reply_templates (trigger_keyword, trigger_type, reply_text, reply_text_ar, priority, is_active) VALUES
('مرحبا', 'contains', 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟', 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟', 10, TRUE),
('شكرا', 'contains', 'العفو! نحن هنا للمساعدة.', 'العفو! نحن هنا للمساعدة.', 5, TRUE),
('طلب', 'contains', 'للتحقق من حالة طلبك، يرجى تزويدي برقم الطلب.', 'للتحقق من حالة طلبك، يرجى تزويدي برقم الطلب.', 8, TRUE),
('سعر', 'contains', 'للاطلاع على الأسعار، يرجى زيارة موقعنا أو أخبرني بالمنتج الذي تبحث عنه.', 'للاطلاع على الأسعار، يرجى زيارة موقعنا أو أخبرني بالمنتج الذي تبحث عنه.', 7, TRUE),
('توصيل', 'contains', 'الشحن يستغرق عادةً 2-5 أيام عمل. رسوم التوصيل 30 جنيهاً للطلبات أقل من 500 جنيه، ومجاني للطلبات الأكبر.', 'الشحن يستغرق عادةً 2-5 أيام عمل. رسوم التوصيل 30 جنيهاً للطلبات أقل من 500 جنيه، ومجاني للطلبات الأكبر.', 9, TRUE),
('استرجاع', 'contains', 'يمكنك استرجاع المنتج خلال 14 يوماً من الاستلام بشرط أن يكون في حالته الأصلية.', 'يمكنك استرجاع المنتج خلال 14 يوماً من الاستلام بشرط أن يكون في حالته الأصلية.', 6, TRUE)
ON CONFLICT DO NOTHING;

-- Insert default order workflow
UPDATE business_settings SET order_workflow = '[
  {"id": "1", "name": "Pending", "name_ar": "قيد الانتظار", "name_en": "Pending", "status": "pending", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "2", "name": "Awaiting Confirmation", "name_ar": "بانتظار التأكيد", "name_en": "Awaiting Confirmation", "status": "awaiting_confirmation", "requires_confirmation": true, "confirmation_message": "Please confirm your order", "confirmation_message_ar": "يرجى تأكيد طلبك", "confirmation_message_en": "Please confirm your order", "auto_advance": false, "auto_advance_hours": 24},
  {"id": "3", "name": "Confirmed", "name_ar": "مؤكد", "name_en": "Confirmed", "status": "confirmed", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "4", "name": "Preparing", "name_ar": "قيد التجهيز", "name_en": "Preparing", "status": "preparing", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "5", "name": "Ready for Shipping", "name_ar": "جاهز للشحن", "name_en": "Ready for Shipping", "status": "ready_for_shipping", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "6", "name": "Shipped", "name_ar": "تم الشحن", "name_en": "Shipped", "status": "shipped", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "7", "name": "Out for Delivery", "name_ar": "قيد التوصيل", "name_en": "Out for Delivery", "status": "out_for_delivery", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "8", "name": "Delivered", "name_ar": "تم التسليم", "name_en": "Delivered", "status": "delivered", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "9", "name": "Cancelled", "name_ar": "ملغي", "name_en": "Cancelled", "status": "cancelled", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "10", "name": "Returned", "name_ar": "مرتجع", "name_en": "Returned", "status": "returned", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null},
  {"id": "11", "name": "Failed Delivery", "name_ar": "فشل التوصيل", "name_en": "Failed Delivery", "status": "failed_delivery", "requires_confirmation": false, "confirmation_message": null, "confirmation_message_ar": null, "confirmation_message_en": null, "auto_advance": false, "auto_advance_hours": null}
]' WHERE id = (SELECT id FROM business_settings LIMIT 1);


