-- ============================================================================
-- Backend service_role permissions (the role every API route uses).
-- RLS still fully protects the `authenticated` role; service_role is
-- server-only (Vercel functions) and is required for webhook imports.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.easyorders_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.easyorders_sync_job_details TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.easyorders_sync_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.easyorders_sync_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.easyorders_webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.export_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_base TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_confirmation_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_confirmation_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_confirmations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_status_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
