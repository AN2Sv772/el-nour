-- ============================================================================
-- MIGRATION: Fix GRANT permissions for authenticated role
-- ============================================================================

-- Grant SELECT on user_profiles to authenticated role
GRANT SELECT ON public.user_profiles TO authenticated;

-- Grant all needed permissions on user_profiles
GRANT INSERT, UPDATE ON public.user_profiles TO authenticated;

-- Also ensure other tables have proper grants
GRANT SELECT ON public.customers TO authenticated;
GRANT INSERT, UPDATE ON public.customers TO authenticated;

GRANT SELECT ON public.products TO authenticated;
GRANT INSERT, UPDATE ON public.products TO authenticated;

GRANT SELECT ON public.orders TO authenticated;
GRANT INSERT, UPDATE ON public.orders TO authenticated;

GRANT SELECT ON public.order_items TO authenticated;
GRANT INSERT, UPDATE ON public.order_items TO authenticated;

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT INSERT, UPDATE ON public.whatsapp_conversations TO authenticated;

GRANT SELECT ON public.whatsapp_messages TO authenticated;
GRANT INSERT ON public.whatsapp_messages TO authenticated;

GRANT SELECT ON public.auto_reply_templates TO authenticated;
GRANT INSERT, UPDATE ON public.auto_reply_templates TO authenticated;

GRANT SELECT ON public.automation_logs TO authenticated;

GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT INSERT, UPDATE ON public.inventory_movements TO authenticated;

GRANT SELECT ON public.notifications TO authenticated;
GRANT INSERT, UPDATE ON public.notifications TO authenticated;

GRANT SELECT ON public.saved_filters TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.saved_filters TO authenticated;

GRANT SELECT ON public.export_jobs TO authenticated;
GRANT INSERT ON public.export_jobs TO authenticated;

GRANT SELECT ON public.import_jobs TO authenticated;
GRANT INSERT ON public.import_jobs TO authenticated;

GRANT SELECT ON public.ai_config TO authenticated;

GRANT SELECT ON public.business_settings TO authenticated;

GRANT SELECT ON public.whatsapp_config TO authenticated;

GRANT SELECT ON public.easyorders_config TO authenticated;
GRANT INSERT, UPDATE ON public.easyorders_config TO authenticated;

GRANT SELECT ON public.order_status_history TO authenticated;
GRANT INSERT ON public.order_status_history TO authenticated;

GRANT SELECT ON public.easyorders_sync_jobs TO authenticated;
GRANT INSERT, UPDATE ON public.easyorders_sync_jobs TO authenticated;

GRANT SELECT ON public.easyorders_webhook_events TO authenticated;
GRANT INSERT ON public.easyorders_webhook_events TO authenticated;

GRANT SELECT ON public.easyorders_sync_job_details TO authenticated;
GRANT INSERT ON public.easyorders_sync_job_details TO authenticated;

-- Grant usage on sequences for auto-increment IDs
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
