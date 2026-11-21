# EL_NOUR_COMPLETE_FEATURE_INVENTORY.md — جرد الميزات الكامل (مُكتشف من الكود + الواجهة)

| # | الميزة | الموقع | الوظيفة | الخلفية | الجداول | الحالة |
|---|--------|--------|---------|---------|---------|--------|
| 1 | تسجيل الدخول | /login | بريد+كلمة مرور عبر Supabase Auth | signInWithPassword (عميل) | auth.users | ✅ مُختبر |
| 2 | تسجيل حساب | /register + /api/auth/register | إنشاء مستخدم مُؤكد تلقائيًا + بروفايل | admin.createUser | auth.users, user_profiles | ✅ |
| 3 | نسيان/إعادة كلمة المرور | /forgot-password, /reset-password | resetPasswordForEmail + updateUser | Supabase Auth | — | ⚠️ جزئي (BUG-10) |
| 4 | حماية المسارات | middleware | بوابة جلسة + 401 JSON للـ API + rate limit | getSession (بلا تحديث — يمنع سباق التوكن) | — | ✅ مُختبر |
| 5 | لوحة التحكم | /dashboard + 4 APIs | مؤشرات حية + رسم + حالة + توصيل + أحدث | service client | orders, customers, order_items, products, expenses, collection_batches | ✅ (بعد توحيد المبيعات) |
| 6 | قائمة الطلبات | /orders + /api/orders | بحث مرحلي، فلاتر، صفحات، تحديد جماعي، Realtime | service client + اشتراك | orders, order_items, customers | ✅ |
| 7 | تفاصيل الطلب | /orders/[id] | بنود + لقطات تكلفة + سجل حالة + عنوان | | orders, order_items, order_status_history | ✅ |
| 8 | تغيير حالة الطلب | dropdown | PATCH | | orders, order_status_history, notifications | ✅ |
| 9 | إنشاء/تعديل طلب | dialog | RHF+Zod، لقطة تكلفة، فحص مخزون | | orders, order_items, products, notifications, automation_logs | ✅ |
| 10 | العملاء | /customers + API | قائمة/بحث/pagination + wa.me | | customers | ✅ |
| 11 | تفاصيل العميل | /customers/[id] | إحصاءات + سجل طلبات | | customers, orders | ✅ |
| 12 | المنتجات | /products + API | قائمة + إنشاء + فلاتر | | products | ✅ |
| 13 | تعديل منتج + مخزون | /products/[id]/edit + API | تكلفة بجرد تدقيق + حركات | PATCH + inventory/adjust | products, product_cost_history, inventory_movements, audit_log | ✅ |
| 14 | التسوية اليومية | /reconciliation + API | معاينة حية + إرجاعات + استرجاع مخزون + إغلاق/إعادة فتح | | daily_reconciliations(+items), inventory_movements, products, expenses, audit_log | ⚠️ يعمل؛ الذرّية تتطلب RPC |
| 15 | مطابقة التحصيل | /collections + API | دفعات + استقطاعات + تخصيص + فروق | | collection_batches/deductions/allocations, orders, audit_log | ✅ |
| 16 | التقارير المالية | /reports + API | أولي/بعد تسوية + مصروفات CRUD + يومي + ربحية منتجات | | orders, order_items, expenses, products, daily_reconciliations | ✅ |
| 17 | إعدادات العمل | /settings + API | singleton + تحقق Zod | | business_settings | ✅ (بعد الإصلاح) |
| 18 | EasyOrders: التكوين والاتصال | /settings/integrations | مفتاح مشفّر AES-GCM + اختبار عبر /products | | easyorders_config | ✅ |
| 19 | EasyOrders: الويب هوك | /webhook | 202 + طابور دائم + dedup | | easyorders_webhook_events, orders(+items), customers, products | ✅ |
| 20 | EasyOrders: الطابور الذاتي | /process-queue | claim ذرّي + backoff + dead-letter + سلسلة after() | | easyorders_webhook_events | ✅ |
| 21 | EasyOrders: الاستخراج التاريخي | /backfill | short_id تسلسلي + checkpoint + idempotent | | easyorders_config, orders(+items), customers, products | ✅ حي 82/1780 |
| 22 | تشخيص المزامنة | webhook-attempts + stats | محاولات + عدادات + إعادة محاولة dead-letter | | automation_logs, easyorders_webhook_events | ✅ |
| 23 | تأكيد الطلبات (هيكل) | /api/integrations/order-confirmation(+cron) | إعدادات + إحصاء + cron تذكير/انتهاء | (المراسلة أُزيلت بقرار) | order_confirmations* | ⚠️ هيكل فقط |
| 24 | قاعدة المعرفة | /settings/integrations + API | CRUD أسئلة/أجوبة | | knowledge_base | ✅ |
| 25 | التصدير | /api/export/excel | orders/order_items/customers/products/sales_report + orderIds + تعقيم | | حسب النوع | ✅ |
| 26 | سجل التدقيق | audit_log | من قدّم ماذا ومتى (قديم/جديد) | | audit_log | ✅ |

**العناصر الميتة/المكررة المزالة أثناء الجولات:** /inbox، إعدادات AI، /api/easyorders القديمة، dead links (8 صفحات أُنشئت بدلها)
