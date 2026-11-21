-- ============================================================================
-- MIGRATION 006: Seed Data
-- Description: Default data for business settings, AI config, and auto-reply templates
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql
-- ============================================================================

-- Insert default business settings
INSERT INTO business_settings (business_name, business_name_ar, currency, timezone, default_shipping_fee, tax_rate)
VALUES ('El Nour Dashboard', 'داشبورد النور', 'EGP', 'Africa/Cairo', 30.00, 14.0)
ON CONFLICT DO NOTHING;

-- Insert default AI config
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
