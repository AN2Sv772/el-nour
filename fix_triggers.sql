-- ============================================================================
-- IDEMPOTENT TRIGGER FIX: Drop and recreate all triggers to avoid conflicts
-- Run this BEFORE combined_migrations_fixed.sql if triggers already exist
-- ============================================================================

-- Drop all triggers that might conflict
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
DROP TRIGGER IF EXISTS update_order_items_updated_at ON order_items;
DROP TRIGGER IF EXISTS update_whatsapp_conversations_updated_at ON whatsapp_conversations;
DROP TRIGGER IF EXISTS update_whatsapp_messages_updated_at ON whatsapp_messages;
DROP TRIGGER IF EXISTS update_auto_reply_templates_updated_at ON auto_reply_templates;
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS update_business_settings_updated_at ON business_settings;
DROP TRIGGER IF EXISTS update_whatsapp_config_updated_at ON whatsapp_config;
DROP TRIGGER IF EXISTS update_ai_config_updated_at ON ai_config;
DROP TRIGGER IF EXISTS update_easyorders_config_updated_at ON easyorders_config;
DROP TRIGGER IF EXISTS update_easyorders_sync_jobs_updated_at ON easyorders_sync_jobs;
DROP TRIGGER IF EXISTS update_easyorders_sync_job_details_updated_at ON easyorders_sync_job_details;
DROP TRIGGER IF EXISTS update_easyorders_webhook_events_updated_at ON easyorders_webhook_events;
DROP TRIGGER IF EXISTS update_easyorders_sync_jobs_updated_at ON easyorders_sync_jobs;
DROP TRIGGER IF EXISTS update_easyorders_webhook_events_updated_at ON easyorders_webhook_events;
DROP TRIGGER IF EXISTS update_easyorders_sync_job_details_updated_at ON easyorders_sync_job_details;
DROP TRIGGER IF EXISTS reserve_inventory_on_confirm_trigger ON orders;
DROP TRIGGER IF EXISTS handle_order_status_change_trigger ON orders;
DROP TRIGGER IF EXISTS update_customer_stats_trigger ON orders;
DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
DROP TRIGGER IF EXISTS update_customer_last_interaction_on_order_trigger ON orders;
DROP TRIGGER IF EXISTS update_customer_last_interaction ON whatsapp_messages;

SELECT 'Triggers cleaned up successfully' as status;
