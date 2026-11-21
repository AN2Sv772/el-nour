-- ============================================================================
-- MIGRATION: Production Features (FIXED - idempotent policies)
-- WhatsApp QR sessions, Knowledge Base, Automation Rules, Sync Logs
-- Run in Supabase Dashboard SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. WHATSAPP SESSIONS (for Baileys QR pairing — managed by external worker)
-- ============================================================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  phone_number VARCHAR(20),
  session_name VARCHAR(100) NOT NULL DEFAULT 'main',
  status VARCHAR(20) NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected','initializing','waiting_qr','qr_expired','connecting','connected','reconnecting','failed')),
  qr_code TEXT,                -- Base64 QR string (transient — only while waiting_qr)
  qr_expires_at TIMESTAMPTZ,
  connected_phone VARCHAR(20),
  last_connected_at TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  session_data_encrypted TEXT, -- Baileys session creds (AES-256-GCM encrypted by worker)
  worker_id VARCHAR(100),      -- ID of the worker process managing this session
  health_check_at TIMESTAMPTZ,
  connection_events JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, session_name)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status ON whatsapp_sessions(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace ON whatsapp_sessions(workspace_id);

-- ============================================================================
-- 2. EXTEND AI CONFIG (add provider, model, api key, knowledge settings)
-- ============================================================================
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS provider VARCHAR(30) DEFAULT 'openai';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS model VARCHAR(100) DEFAULT 'gpt-4o-mini';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS business_description TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS response_delay_seconds INTEGER DEFAULT 2;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS max_response_length INTEGER DEFAULT 500;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS fallback_response TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'ar-EG';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS memory_messages INTEGER DEFAULT 10;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS order_aware BOOLEAN DEFAULT TRUE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS working_hours_enabled BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 3. KNOWLEDGE BASE (FAQ + business info for AI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(50) NOT NULL DEFAULT 'faq'
    CHECK (category IN ('faq','product_info','shipping','payment','return_policy','working_hours','contact','custom')),
  question TEXT,
  answer TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_active ON knowledge_base(is_active) WHERE is_active;

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- Idempotent policies: drop first if exists
DROP POLICY IF EXISTS "Authenticated users can view knowledge base" ON knowledge_base;
CREATE POLICY "Authenticated users can view knowledge base" ON knowledge_base
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can manage knowledge base" ON knowledge_base;
CREATE POLICY "Managers can manage knowledge base" ON knowledge_base
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

-- ============================================================================
-- 4. WHATSAPP AUTOMATION RULES
-- ============================================================================
CREATE TABLE IF NOT EXISTS whatsapp_automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  rule_type VARCHAR(30) NOT NULL DEFAULT 'auto_reply'
    CHECK (rule_type IN ('auto_reply','ignore_contact','ignore_group','escalate_keyword','working_hours','response_delay','human_handoff')),
  conditions JSONB NOT NULL DEFAULT '{}',
  action JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active ON whatsapp_automation_rules(is_active, priority DESC);

ALTER TABLE whatsapp_automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view automation rules" ON whatsapp_automation_rules;
CREATE POLICY "Authenticated users can view automation rules" ON whatsapp_automation_rules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can manage automation rules" ON whatsapp_automation_rules;
CREATE POLICY "Managers can manage automation rules" ON whatsapp_automation_rules
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

-- ============================================================================
-- 5. EASYORDERS SYNC LOGS (detailed history)
-- ============================================================================
CREATE TABLE IF NOT EXISTS easyorders_sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type VARCHAR(30) NOT NULL DEFAULT 'manual'
    CHECK (sync_type IN ('manual','webhook','scheduled','retry')),
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','partial','failed')),
  orders_processed INTEGER DEFAULT 0,
  orders_imported INTEGER DEFAULT 0,
  orders_updated INTEGER DEFAULT 0,
  orders_skipped INTEGER DEFAULT 0,
  orders_failed INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  duration_ms INTEGER,
  triggered_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_easyorders_sync_logs_created ON easyorders_sync_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_easyorders_sync_logs_status ON easyorders_sync_logs(status);

ALTER TABLE easyorders_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view sync logs" ON easyorders_sync_logs;
CREATE POLICY "Authenticated users can view sync logs" ON easyorders_sync_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

DROP POLICY IF EXISTS "Service can insert sync logs" ON easyorders_sync_logs;
CREATE POLICY "Service can insert sync logs" ON easyorders_sync_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================================
-- 6. WHATSAPP SESSIONS RLS
-- ============================================================================
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view whatsapp sessions" ON whatsapp_sessions;
CREATE POLICY "Authenticated users can view whatsapp sessions" ON whatsapp_sessions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can manage whatsapp sessions" ON whatsapp_sessions;
CREATE POLICY "Managers can manage whatsapp sessions" ON whatsapp_sessions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager'))
  );

-- ============================================================================
-- 7. UPDATED_AT TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS update_knowledge_base_updated_at ON knowledge_base;
CREATE TRIGGER update_knowledge_base_updated_at
  BEFORE UPDATE ON knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_automation_rules_updated_at ON whatsapp_automation_rules;
CREATE TRIGGER update_whatsapp_automation_rules_updated_at
  BEFORE UPDATE ON whatsapp_automation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_sessions_updated_at ON whatsapp_sessions;
CREATE TRIGGER update_whatsapp_sessions_updated_at
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 8. SEED DEFAULT KNOWLEDGE BASE (if empty)
-- ============================================================================
INSERT INTO knowledge_base (category, question, answer, keywords, priority)
SELECT * FROM (VALUES
  ('faq', 'ما هي أوقات العمل؟', 'أوقات العمل من 9 صباحاً حتى 10 مساءً طوال أيام الأسبوع.', ARRAY['أوقات','دوام','ساعات'], 10),
  ('faq', 'كم مدة الشحن؟', 'الشحن يستغرق عادة 2-5 أيام عمل داخل المدن الكبرى، و5-7 أيام للمناطق الأخرى.', ARRAY['شحن','توصيل','مدة'], 9),
  ('faq', 'ما هي طرق الدفع المتاحة؟', 'نقبل الدفع عند الاستلام، البطاقات الائتمانية، والتحويل البنكي.', ARRAY['دفع','فيزا','تحويل'], 8),
  ('faq', 'ما هي سياسة الاستبدال والإرجاع؟', 'يمكنك استبدال أو إرجاع المنتج خلال 14 يوماً من الاستلام بشرط أن يكون في حالته الأصلية.', ARRAY['إرجاع','استبدال','استرجاع'], 7)
) AS seed_data(category, question, answer, keywords, priority)
WHERE NOT EXISTS (SELECT 1 FROM knowledge_base LIMIT 1);

-- ============================================================================
-- 9. SEED AUTOMATION RULES (if empty)
-- ============================================================================
INSERT INTO whatsapp_automation_rules (name, rule_type, conditions, action, is_active, priority)
SELECT * FROM (VALUES
  ('الرد على الرسائل الجديدة', 'auto_reply', '{}'::jsonb, '{"enabled": true}'::jsonb, true, 10),
  ('تجاهل رسائل المجموعات', 'ignore_group', '{}'::jsonb, '{"enabled": true}'::jsonb, true, 9),
  ('تحويل للموظف عند طلب العميل', 'human_handoff', '{"keywords": ["مدير","مشرف","موظف","بشري"]}'::jsonb, '{"action": "escalate"}'::jsonb, true, 8)
) AS seed_data(name, rule_type, conditions, action, is_active, priority)
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_automation_rules LIMIT 1);