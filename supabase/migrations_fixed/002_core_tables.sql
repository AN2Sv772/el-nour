-- ============================================================================
-- MIGRATION 002: Core Tables
-- Description: Core application tables with proper constraints and indexes
-- Dependencies: 001_extensions_and_enums.sql
-- ============================================================================

-- Customers table
CREATE TABLE customers (
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

CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_last_interaction ON customers(last_interaction_at DESC);

-- Products table
CREATE TABLE products (
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

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_low_stock ON products(stock_quantity) WHERE track_inventory AND stock_quantity <= low_stock_threshold;

-- Orders table
CREATE TABLE orders (
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

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_assigned_employee ON orders(assigned_employee_id);
CREATE UNIQUE INDEX idx_orders_easyorders_unique 
  ON orders(easyorders_order_id, easyorders_store_id) 
  WHERE easyorders_order_id IS NOT NULL AND easyorders_store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_order_id ON orders(easyorders_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_store_id ON orders(easyorders_store_id);
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_sync_cursor ON orders(easyorders_sync_cursor);

-- Order items table (normalized)
CREATE TABLE order_items (
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

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- WhatsApp conversations table
CREATE TABLE whatsapp_conversations (
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

CREATE INDEX idx_whatsapp_conversations_customer_id ON whatsapp_conversations(customer_id);
CREATE INDEX idx_whatsapp_conversations_status ON whatsapp_conversations(status);
CREATE INDEX idx_whatsapp_conversations_last_message ON whatsapp_conversations(last_message_at DESC);
CREATE INDEX idx_whatsapp_conversations_assigned ON whatsapp_conversations(assigned_to);

-- WhatsApp messages table
CREATE TABLE whatsapp_messages (
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

CREATE INDEX idx_whatsapp_messages_conversation_id ON whatsapp_messages(conversation_id);
CREATE INDEX idx_whatsapp_messages_customer_id ON whatsapp_messages(customer_id);
CREATE UNIQUE INDEX idx_whatsapp_messages_whatsapp_id_inbound 
  ON whatsapp_messages (whatsapp_message_id) 
  WHERE direction = 'inbound';
CREATE INDEX idx_whatsapp_messages_whatsapp_id_outbound 
  ON whatsapp_messages (whatsapp_message_id) 
  WHERE direction = 'outbound';
CREATE INDEX idx_whatsapp_messages_created_at ON whatsapp_messages(created_at DESC);

-- Auto-reply templates table
CREATE TABLE auto_reply_templates (
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

CREATE INDEX idx_auto_reply_templates_keyword ON auto_reply_templates(trigger_keyword);
CREATE INDEX idx_auto_reply_templates_active ON auto_reply_templates(is_active) WHERE is_active;

-- Automation logs table
CREATE TABLE automation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type automation_type NOT NULL,
  status automation_status DEFAULT 'pending',
  reference_id UUID,
  reference_type VARCHAR(50),
  details JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automation_logs_type ON automation_logs(type);
CREATE INDEX idx_automation_logs_status ON automation_logs(status);
CREATE INDEX idx_automation_logs_reference ON automation_logs(reference_id, reference_type);
CREATE INDEX idx_automation_logs_created_at ON automation_logs(created_at DESC);

-- Inventory movements table
CREATE TABLE inventory_movements (
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

CREATE INDEX idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_reference ON inventory_movements(reference_id, reference_type);
CREATE INDEX idx_inventory_movements_created_at ON inventory_movements(created_at DESC);

-- User profiles table
CREATE TABLE user_profiles (
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

CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_is_active ON user_profiles(is_active);

-- Order status history table
CREATE TABLE order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by UUID REFERENCES user_profiles(id),
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX idx_order_status_history_created_at ON order_status_history(created_at DESC);

-- Notifications table
CREATE TABLE notifications (
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

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read) WHERE NOT is_read;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- Saved filters table
CREATE TABLE saved_filters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  entity VARCHAR(50) NOT NULL,
  filters JSONB DEFAULT '{}',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_filters_user_entity ON saved_filters(user_id, entity);

-- Export jobs table
CREATE TABLE export_jobs (
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

CREATE INDEX idx_export_jobs_user_id ON export_jobs(user_id);
CREATE INDEX idx_export_jobs_status ON export_jobs(status);

-- Import jobs table
CREATE TABLE import_jobs (
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

CREATE INDEX idx_import_jobs_user_id ON import_jobs(user_id);
CREATE INDEX idx_import_jobs_status ON import_jobs(status);

-- AI config table
CREATE TABLE ai_config (
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
CREATE TABLE business_settings (
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
CREATE TABLE whatsapp_config (
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
