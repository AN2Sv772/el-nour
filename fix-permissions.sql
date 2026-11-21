-- Grant permissions to service_role for all tables
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.customers TO service_role;
GRANT ALL ON public.products TO service_role;
GRANT ALL ON public.order_items TO service_role;
GRANT ALL ON public.categories TO service_role;
GRANT ALL ON public.product_variants TO service_role;
GRANT ALL ON public.categories TO service_role;
GRANT ALL ON public.users TO service_role;
GRANT ALL ON public.user_profiles TO service_role;
GRANT ALL ON public.coupons TO service_role;
GRANT ALL ON public.coupon_usages TO service_role;
GRANT ALL ON public.inventory_movements TO service_role;
GRANT ALL ON public.automation_logs TO service_role;
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON public.ai_config TO service_role;
GRANT ALL ON public.knowledge_base TO service_role;
GRANT ALL ON public.whatsapp_automation_rules TO service_role;
GRANT ALL ON public.whatsapp_sessions TO service_role;
GRANT ALL ON public.easyorders_config TO service_role;
GRANT ALL ON public.easyorders_sync_logs TO service_role;
GRANT ALL ON public.order_confirmations TO service_role;
GRANT ALL ON public.order_confirmation_events TO service_role;
GRANT ALL ON public.order_confirmation_settings TO service_role;
GRANT ALL ON public.whatsapp_messages TO service_role;
GRANT ALL ON public.whatsapp_sessions TO service_role;
GRANT ALL ON public.easyorders_config TO service_role;
GRANT ALL ON public.easyorders_sync_logs TO service_role;
GRANT ALL ON public.order_confirmations TO service_role;
GRANT ALL ON public.order_confirmation_events TO service_role;
GRANT ALL ON public.order_confirmation_settings TO service_role;
GRANT ALL ON public.whatsapp_messages TO service_role;
GRANT ALL ON public.whatsapp_sessions TO service_role;

-- Grant sequence permissions
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant all on all tables in public schema to service_role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Enable RLS bypass for service role
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.easyorders_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.easyorders_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_confirmation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_confirmation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Create policies for service_role to bypass RLS
CREATE POLICY "service_role_all" ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.customers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.order_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.categories FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.product_variants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.user_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.coupons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.coupon_usages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.inventory_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.automation_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.ai_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.knowledge_base FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.whatsapp_automation_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.whatsapp_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.easyorders_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.easyorders_sync_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.order_confirmations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.order_confirmation_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.order_confirmation_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.whatsapp_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.whatsapp_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
