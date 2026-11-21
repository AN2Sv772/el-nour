-- ============================================================================
-- MIGRATION: Remove WhatsApp Integration Completely
-- This migration removes all WhatsApp-related tables, policies, and functions
-- ============================================================================

-- Drop triggers first (must be done before dropping tables)
DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
DROP TRIGGER IF EXISTS update_whatsapp_conversations_updated_at ON whatsapp_conversations;
DROP TRIGGER IF EXISTS update_whatsapp_messages_updated_at ON whatsapp_messages;
DROP TRIGGER IF EXISTS update_whatsapp_config_updated_at ON whatsapp_config;
DROP TRIGGER IF EXISTS update_whatsapp_sessions_updated_at ON whatsapp_sessions;
DROP TRIGGER IF EXISTS update_whatsapp_automation_rules_updated_at ON whatsapp_automation_rules;
DROP TRIGGER IF EXISTS update_whatsapp_sessions_updated_at ON whatsapp_sessions;

-- Drop functions
DROP FUNCTION IF EXISTS update_customer_last_interaction();
DROP FUNCTION IF EXISTS handle_order_status_change();
DROP FUNCTION IF EXISTS reserve_inventory_on_confirm();

-- Drop tables in correct order (respecting foreign keys)
DROP TABLE IF EXISTS whatsapp_automation_rules;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_automation_rules;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS whatsapp_conversations;
DROP TABLE IF EXISTS whatsapp_config;

-- Drop indexes
DROP INDEX IF EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_created_at;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_inbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_outbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;

-- Drop policies
DROP POLICY IF EXISTS "Enable all for authenticated users" ON whatsapp_conversations;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON whatsapp_messages;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON whatsapp_config;
DROP POLICY IF EXISTS "Authenticated users can view conversations" ON whatsapp_conversations;
DROP POLICY IF EXISTS "Assigned employees can update conversations" ON whatsapp_conversations;
DROP POLICY IF EXISTS "Authenticated users can view messages" ON whatsapp_messages;
DROP POLICY IF EXISTS "Employees can create messages" ON whatsapp_messages;
DROP POLICY IF EXISTS "Admins can manage WhatsApp config" ON whatsapp_config;
DROP POLICY IF EXISTS "Authenticated users can view whatsapp sessions" ON whatsapp_sessions;
DROP POLICY IF EXISTS "Managers can manage whatsapp sessions" ON whatsapp_sessions;
DROP POLICY IF EXISTS "Authenticated users can view automation rules" ON whatsapp_automation_rules;
DROP POLICY IF EXISTS "Managers can manage automation rules" ON whatsapp_automation_rules;
DROP POLICY IF EXISTS "Authenticated users can view whatsapp sessions" ON whatsapp_sessions;
DROP POLICY IF EXISTS "Managers can manage whatsapp sessions" ON whatsapp_sessions;
DROP POLICY IF EXISTS "Authenticated users can view knowledge base" ON knowledge_base;
DROP POLICY IF EXISTS "Managers can manage knowledge base" ON knowledge_base;
DROP POLICY IF EXISTS "Authenticated users can view automation rules" ON whatsapp_automation_rules;
DROP POLICY IF EXISTS "Managers can manage automation rules" ON whatsapp_automation_rules;
DROP POLICY IF EXISTS "Authenticated users can view whatsapp sessions" ON whatsapp_sessions;
DROP POLICY IF EXISTS "Managers can manage whatsapp sessions" ON whatsapp_sessions;

-- Drop tables (in correct order to respect foreign keys)
DROP TABLE IF EXISTS whatsapp_automation_rules;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_automation_rules;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS whatsapp_conversations;
DROP TABLE IF EXISTS whatsapp_config;

-- Drop indexes
DROP INDEX IF EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_created_at;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_inbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_outbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_created_at;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_inbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_outbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message;
DROP INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_created_at;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_inbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id_outbound;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_customer_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_status;
DROP INDEX IF NOT EXISTS idx_whatsapp_sessions_workspace;
DROP INDEX IF NOT EXISTS idx_whatsapp_automation_rules_active;

-- Drop tables (in correct order to respect foreign keys)
DROP TABLE IF EXISTS whatsapp_automation_rules;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_automation_rules;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS whatsapp_conversations;
DROP TABLE IF EXISTS whatsapp_config;

-- Drop order confirmation WhatsApp fields
ALTER TABLE order_confirmations DROP COLUMN IF EXISTS confirmation_message_id;
ALTER TABLE order_confirmations DROP COLUMN IF EXISTS customer_response_id;
ALTER TABLE order_confirmations DROP COLUMN IF EXISTS whatsapp_message_id;

-- Drop functions
DROP FUNCTION IF EXISTS update_customer_last_interaction();
DROP FUNCTION IF EXISTS handle_order_status_change();
DROP FUNCTION IF EXISTS reserve_inventory_on_confirm();
DROP FUNCTION IF EXISTS send_reminders(uuid);
DROP FUNCTION IF EXISTS expire_confirmations(uuid);
DROP FUNCTION IF EXISTS send_order_confirmation(uuid);

