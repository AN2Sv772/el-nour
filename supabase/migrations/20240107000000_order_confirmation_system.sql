-- ============================================================================
-- MIGRATION: WhatsApp Interactive Order Confirmation System
-- Tracks confirmation sessions, customer responses, and modification flows
-- Run in Supabase Dashboard SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. ORDER CONFIRMATIONS — Main tracking table
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  easyorders_order_id TEXT,
  customer_id UUID NOT NULL REFERENCES customers(id),
  customer_phone VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status IN (
      'awaiting_confirmation',
      'confirmed',
      'modification_requested',
      'cancellation_requested',
      'cancelled',
      'expired',
      'human_review'
    )),
  confirmation_message_id TEXT,       -- WhatsApp message ID of the confirmation
  customer_response_id TEXT,          -- WhatsApp message ID of customer's reply
  confirmed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  reminder_count INTEGER DEFAULT 0,
  max_reminders INTEGER DEFAULT 2,
  last_reminder_at TIMESTAMPTZ,
  modification_type VARCHAR(30),      -- address|phone|products|quantities|notes|support
  modification_data JSONB,            -- Proposed changes before customer confirms
  cancellation_reason TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'easyorders',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id)                    -- One confirmation per order — prevents duplicates
);

CREATE INDEX IF NOT EXISTS idx_order_confirmations_status ON order_confirmations(status);
CREATE INDEX IF NOT EXISTS idx_order_confirmations_phone ON order_confirmations(customer_phone);
CREATE INDEX IF NOT EXISTS idx_order_confirmations_order ON order_confirmations(order_id);
CREATE INDEX IF NOT EXISTS idx_order_confirmations_expires ON order_confirmations(expires_at)
  WHERE status = 'awaiting_confirmation';

-- ============================================================================
-- 2. CONFIRMATION EVENTS — Audit log of every interaction
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_confirmation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confirmation_id UUID NOT NULL REFERENCES order_confirmations(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL
    CHECK (event_type IN (
      'confirmation_sent',
      'customer_replied',
      'order_confirmed',
      'modification_started',
      'modification_data_collected',
      'modification_confirmed',
      'modification_applied',
      'cancellation_started',
      'cancellation_confirmed',
      'order_cancelled',
      'reminder_sent',
      'expired',
      'escalated_human',
      'message_failed',
      'duplicate_ignored'
    )),
  event_data JSONB DEFAULT '{}',
  whatsapp_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_events_confirmation ON order_confirmation_events(confirmation_id);
CREATE INDEX IF NOT EXISTS idx_oc_events_type ON order_confirmation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_oc_events_created ON order_confirmation_events(created_at DESC);

-- ============================================================================
-- 3. ORDER CONFIRMATION SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_confirmation_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  enabled BOOLEAN DEFAULT TRUE,
  message_template TEXT DEFAULT 'أهلاً {{customer_name}} 👋

شكراً لطلبك من متجر النور ❤️

تم تسجيل طلبك بنجاح، ودي تفاصيل الأوردر:

رقم الطلب: #{{order_number}}

المنتجات:
{{products}}

قيمة المنتجات: {{subtotal}} جنيه
الشحن: {{shipping}} جنيه
الخصم: {{discount}} جنيه

الإجمالي النهائي: {{total}} جنيه

العنوان: {{delivery_address}}

برجاء اختيار الإجراء المناسب:

1️⃣ تأكيد الطلب
2️⃣ تعديل الطلب
3️⃣ إلغاء الطلب
4️⃣ محتاج مساعدة

اكتب رقم الاختيار',
  confirmation_timeout_hours INTEGER DEFAULT 24,
  reminder_enabled BOOLEAN DEFAULT TRUE,
  reminder_interval_hours INTEGER DEFAULT 6,
  max_reminders INTEGER DEFAULT 2,
  working_hours_enabled BOOLEAN DEFAULT FALSE,
  working_hours_start VARCHAR(5) DEFAULT '09:00',
  working_hours_end VARCHAR(5) DEFAULT '22:00',
  eligibility_min_total DECIMAL(10,2) DEFAULT 0,
  eligibility_payment_methods TEXT[] DEFAULT '{cash_on_delivery}',
  eligibility_statuses TEXT[] DEFAULT '{pending,awaiting_confirmation}',
  fallback_message TEXT DEFAULT 'عذراً، لم نفهم ردك. من فضلك اكتب 1 للتأكيد، 2 للتعديل، أو 3 للإلغاء.',
  timeout_message TEXT DEFAULT 'انتهت صلاحية تأكيد الطلب. سيتواصل معك أحد موظفينا قريباً.',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE order_confirmation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view confirmation settings" ON order_confirmation_settings;
CREATE POLICY "Authenticated users can view confirmation settings" ON order_confirmation_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can manage confirmation settings" ON order_confirmation_settings;
CREATE POLICY "Managers can manage confirmation settings" ON order_confirmation_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

-- ============================================================================
-- 4. RLS FOR CONFIRMATIONS
-- ============================================================================
ALTER TABLE order_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view confirmations" ON order_confirmations;
CREATE POLICY "Authenticated users can view confirmations" ON order_confirmations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can manage confirmations" ON order_confirmations;
CREATE POLICY "Managers can manage confirmations" ON order_confirmations
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

-- ============================================================================
-- 5. RLS FOR CONFIRMATION EVENTS
-- ============================================================================
ALTER TABLE order_confirmation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view confirmation events" ON order_confirmation_events;
CREATE POLICY "Authenticated users can view confirmation events" ON order_confirmation_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

DROP POLICY IF EXISTS "Service can insert confirmation events" ON order_confirmation_events;
CREATE POLICY "Service can insert confirmation events" ON order_confirmation_events
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS update_order_confirmations_updated_at ON order_confirmations;
CREATE TRIGGER update_order_confirmations_updated_at
  BEFORE UPDATE ON order_confirmations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. SEED DEFAULT SETTINGS (if empty)
-- ============================================================================
INSERT INTO order_confirmation_settings (enabled)
SELECT TRUE
WHERE NOT EXISTS (SELECT 1 FROM order_confirmation_settings LIMIT 1);

-- ============================================================================
-- 8. ADD confirmation_status to orders table for quick filtering
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(30)
  DEFAULT NULL
  CHECK (confirmation_status IS NULL OR confirmation_status IN (
    'awaiting_confirmation','confirmed','modification_requested',
    'cancellation_requested','cancelled','expired','human_review'
  ));

CREATE INDEX IF NOT EXISTS idx_orders_confirmation_status ON orders(confirmation_status)
  WHERE confirmation_status IS NOT NULL;
