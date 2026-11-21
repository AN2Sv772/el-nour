-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom types
CREATE TYPE order_status AS ENUM (
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'ready_for_shipping',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'failed_delivery'
);

CREATE TYPE payment_status AS ENUM (
  'pending',
  'paid',
  'partial',
  'refunded',
  'failed'
);

CREATE TYPE payment_method AS ENUM (
  'cash_on_delivery',
  'card',
  'bank_transfer',
  'wallet',
  'other'
);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_type AS ENUM ('text', 'template', 'image', 'document', 'audio', 'video', 'location', 'contacts');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');
CREATE TYPE conversation_status AS ENUM ('open', 'closed', 'pending', 'escalated');
CREATE TYPE automation_type AS ENUM ('auto_reply', 'order_created', 'order_updated', 'inventory_updated', 'notification_sent', 'ai_escalation', 'webhook_received');
CREATE TYPE automation_status AS ENUM ('success', 'failed', 'pending');
CREATE TYPE inventory_movement_type AS ENUM ('in', 'out', 'adjustment', 'reserved', 'released');
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee', 'viewer');
CREATE TYPE notification_type AS ENUM ('new_order', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'low_stock', 'failed_delivery', 'ai_escalation', 'payment_received', 'system');
CREATE TYPE export_job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE export_format AS ENUM ('xlsx', 'csv');
CREATE TYPE import_job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'preview');

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_assigned_employee ON orders(assigned_employee_id);

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
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) DEFAULT 0,
  total_price DECIMAL(12,2) NOT NULL
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
  whatsapp_message_id VARCHAR(100) UNIQUE,
  status message_status DEFAULT 'sent',
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
CREATE INDEX idx_whatsapp_messages_whatsapp_id ON whatsapp_messages(whatsapp_message_id);
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

-- Enable Row Level Security
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

-- RLS Policies (allow authenticated users to read/write based on role)
-- For simplicity, we allow all authenticated users full access
-- In production, you'd want more granular policies

CREATE POLICY "Enable all for authenticated users" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON whatsapp_conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON whatsapp_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON auto_reply_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON automation_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON inventory_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON user_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON order_status_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON saved_filters FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON export_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON import_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON ai_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON business_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON whatsapp_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable Realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE products;

-- Functions for updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_whatsapp_conversations_updated_at BEFORE UPDATE ON whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_whatsapp_messages_updated_at BEFORE UPDATE ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_auto_reply_templates_updated_at BEFORE UPDATE ON auto_reply_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_business_settings_updated_at BEFORE UPDATE ON business_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_whatsapp_config_updated_at BEFORE UPDATE ON whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ai_config_updated_at BEFORE UPDATE ON ai_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update customer stats
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
$$ language 'plpgsql';

CREATE TRIGGER update_customer_stats_trigger
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_customer_stats();

-- Function to handle order status changes
CREATE OR REPLACE FUNCTION handle_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_by UUID;
BEGIN
  IF OLD.status != NEW.status THEN
    -- Get the user who made the change (from request context if available)
    v_changed_by := current_setting('request.jwt.claims', true)::json->>'sub';
    
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
$$ language 'plpgsql';

CREATE TRIGGER handle_order_status_change_trigger
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION handle_order_status_change();

-- Function to reserve inventory on order confirmation
CREATE OR REPLACE FUNCTION reserve_inventory_on_confirm()
RETURNS TRIGGER AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
BEGIN
  IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
      v_quantity := (v_item->>'quantity')::INTEGER;
      
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
$$ language 'plpgsql';

CREATE TRIGGER reserve_inventory_on_confirm_trigger
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION reserve_inventory_on_confirm();

-- Insert default data
INSERT INTO business_settings (business_name, business_name_ar, currency, timezone, default_shipping_fee, tax_rate)
VALUES ('El Nour Dashboard', 'داشبورد النور', 'EGP', 'Africa/Cairo', 30.00, 14.0)
ON CONFLICT DO NOTHING;

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