# EL_NOUR_DATABASE_AUDIT.md — تدقيق قاعدة البيانات

## الجداول (مفحوصة عبر OpenAPI REST + migrations)
| الجدول | الأعمدة الحرجة | ملاحظات التدقيق |
|--------|----------------|------------------|
| orders | +easyorders_order_id/store_id/sync_cursor/reconciliation_status | 62 صفًا حيًا؛ unique index مركّب على (eo_id, store_id) WHERE NOT NULL |
| order_items | +unit_cost (لقطة) | **لا created_at** (سبّب BUG-5) |
| customers | phone UNIQUE | صفر تكرار في 59 |
| products | +easyorders_product_id (مايجريشن مُطبَّق — تحقق REST) | SKU مُصنَّع EO-<uuid> للمستورد |
| easyorders_webhook_events | +طابور كامل (status/attempts/backoff/claim/dedup) | **تريغر مكسور على UPDATE (BUG-12)** — يتطلب SQL |
| easyorders_config | +backfill checkpoint | cursor/max_id يعملان حيًا |
| collection_batches/deductions/allocations | UNIQUE(order_id) | منع عدّ مزدوج مؤكد |
| daily_reconciliations(+items) | UNIQUE(business_date) | 409 مزدوج مؤكد |
| expenses | +voided_at (إلغاء ناعم) | أُضيف/أُلغي حيًا والتقرير تتبّع |
| business_settings | **4 صفوف مكررة** | القيد يتطلب المايجريشن |
| automation_logs | enum automation_type | قيم جديدة بالمايجريشن |
| user_profiles | trigger auto-create من auth.users | مُطبَّق (البروفايل يُنشأ) |

## RLS (مفحوص دور anon مباشرة)
orders/customers/products/user_profiles/easyorders_config/expenses/daily_reconciliations → **كلها 401/مرفوضة** ✅
service_role: منح دقيق جدول-جدول (مُبرر: خلفية فقط)

## الدوال
- claim_webhook_events (RPC) — **مُعطَّلة عمليًا بسبب التريغر**؛ الكود يعتمد الآن claim ذرّي بديل (test-and-set) يعمل بدون DDL
- close_daily_reconciliation (RPC ذرّي) — **بانتظار تشغيلك**
- handle_new_user + update_updated_at_column — مُطبَّقة

## مايجريشنات بانتظارك (إضافية آمنة، بالترتيب)
1. 20240122000000_fix_webhook_events_trigger.sql ← **يفكّ BUG-12**
2. 20240119000000_atomic_reconciliation.sql ← يفكّ BUG-7
3. 20240120000000_business_settings_singleton.sql ← يقفل BUG-3 نهائيًا
4. 20240121000000_automation_type_values.sql ← يقفل BUG-6/13
