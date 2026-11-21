-- ============================================================================
-- PRE-MIGRATION CLEANUP: Drop all existing policies to avoid conflicts
-- Run this FIRST in Supabase SQL Editor before running combined_migrations_fixed.sql
-- ============================================================================

-- Drop all policies on all tables (safe to run multiple times)
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Also drop any existing functions that might conflict
DROP FUNCTION IF EXISTS create_order_atomic(UUID, JSONB, JSONB, JSONB, payment_method, DECIMAL, DECIMAL, DECIMAL, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS handle_order_status_change();
DROP FUNCTION IF EXISTS reserve_inventory_on_confirm();
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS update_customer_stats();
DROP FUNCTION IF EXISTS update_customer_last_interaction();
DROP FUNCTION IF EXISTS update_customer_last_interaction_on_order();
DROP FUNCTION IF EXISTS update_customer_last_interaction();
DROP FUNCTION IF EXISTS cleanup_old_easyorders_webhook_events();
DROP FUNCTION IF EXISTS get_or_create_easyorders_config();
DROP FUNCTION IF EXISTS map_easyorders_status;
DROP FUNCTION IF EXISTS map_payment_method;
DROP FUNCTION IF EXISTS normalize_phone_for_whatsapp;
DROP FUNCTION IF EXISTS verify_easyorders_webhook_signature;
DROP FUNCTION IF EXISTS parse_easyorders_webhook;
DROP FUNCTION IF EXISTS cleanup_old_easyorders_webhook_events;
DROP FUNCTION IF EXISTS get_or_create_easyorders_config;
DROP FUNCTION IF EXISTS map_easyorders_status;
DROP FUNCTION IF EXISTS map_payment_method;
DROP FUNCTION IF EXISTS normalize_phone_for_whatsapp;
DROP FUNCTION IF EXISTS verify_easyorders_webhook_signature;
DROP FUNCTION IF EXISTS parse_easyorders_webhook;
DROP FUNCTION IF EXISTS create_policy_if_not_exists;

-- Drop all existing triggers to avoid conflicts
DROP TRIGGER IF EXISTS update_customer_stats_trigger ON orders;
DROP TRIGGER IF EXISTS handle_order_status_change_trigger ON orders;
DROP TRIGGER IF EXISTS reserve_inventory_on_confirm_trigger ON orders;
DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
DROP TRIGGER IF EXISTS update_customer_last_interaction_on_order_trigger ON orders;
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

-- Drop helper functions
DROP FUNCTION IF EXISTS create_policy_if_not_exists;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS update_customer_stats();
DROP FUNCTION IF EXISTS handle_order_status_change();
DROP FUNCTION IF EXISTS reserve_inventory_on_confirm();
DROP FUNCTION IF EXISTS update_customer_last_interaction();
DROP FUNCTION IF EXISTS update_customer_last_interaction_on_order();
DROP FUNCTION IF EXISTS cleanup_old_easyorders_webhook_events();
DROP FUNCTION IF EXISTS get_or_create_easyorders_config();
DROP FUNCTION IF EXISTS map_easyorders_status();
DROP FUNCTION IF EXISTS map_payment_method();
DROP FUNCTION IF EXISTS normalize_phone_for_whatsapp();
DROP FUNCTION IF EXISTS verify_easyorders_webhook_signature();
DROP FUNCTION IF EXISTS parse_easyorders_webhook();
DROP FUNCTION IF EXISTS cleanup_old_easyorders_webhook_events();
DROP FUNCTION IF EXISTS get_or_create_easyorders_config();
DROP FUNCTION IF EXISTS map_easyorders_status();
DROP FUNCTION IF EXISTS map_payment_method();
DROP FUNCTION IF EXISTS normalize_phone_for_whatsapp();
DROP FUNCTION IF EXISTS verify_easyorders_webhook_signature();
DROP FUNCTION IF EXISTS parse_easyorders_webhook();
DROP FUNCTION IF EXISTS cleanup_old_easyorders_webhook_events();
DROP FUNCTION IF EXISTS get_or_create_easyorders_config();
DROP FUNCTION IF EXISTS map_easyorders_status();
DROP FUNCTION IF EXISTS map_payment_method();
DROP FUNCTION IF EXISTS normalize_phone_for_whatsapp();
DROP FUNCTION IF EXISTS verify_easyorders_webhook_signature();
DROP FUNCTION IF EXISTS parse_easyorders_webhook();
DROP FUNCTION IF EXISTS create_policy_if_not_exists;

SELECT 'Cleanup completed successfully' as status;
