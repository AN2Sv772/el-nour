# EL_NOUR_BUG_REGISTER.md — سجل الأخطاء الكامل (جولتان)

| ID | الموقع | الوصف | الخطورة | الجذر | الحالة | إعادة الإنتاج |
|----|--------|-------|---------|-------|--------|---------------|
| BUG-1 | /api/orders GET | بحث 500 PGRST100 | High | مؤكد: مرشح مدمج في .or() | ✅ FIXED+DEPLOYED (مرحلتان) | بحث "Esraa" |
| BUG-2 | /api/export/excel | تصدير 500 ByteString | High | مؤكد: U+200F في filename | ✅ FIXED+DEPLOYED | أي تصدير |
| BUG-3 | business_settings | 4 صفوف مكررة، GET 500 | Critical | مؤكد: upsert بلا تعارض | ✅ FIXED (API منشور؛ القيد بالمايجريشن 20240120) | حفظ ثم GET |
| BUG-4 | /api/inventory/adjust | 500 أعمدة خاطئة | High | مؤكد: movement_type/reason غير موجودين | ✅ FIXED+DEPLOYED (type/notes) | تعديل مخزون |
| BUG-5 | top-products | 500 عمود مفقود | High | مؤكد: order_items بلا created_at | ✅ FIXED+DEPLOYED (orders.created_at) | فتح الداشبورد |
| BUG-6 | webhook logs/attempts | 500 enum 22P02 | Medium | مؤكد: قيم خارج automation_type | ✅ FIXED (كود آمن منشور + مايجريشن 20240121) | فتح التكاملات |
| BUG-7 | /api/reconciliation POST | غير ذرّي (حالة جزئية) | **Critical** | مؤكد: إدراجات متسلسلة | 🔧 STAGED — RPC جاهز (20240119) **يحتاج تشغيلك** | إغلاق يوم بفشل مخزون |
| BUG-8 | backfill | فقدان created_at الأصلي | High | مؤكد | ✅ FIXED+DEPLOYED للطلبات الجديدة | مقارنة تواريخ القديمة |
| BUG-9 | dashboard stats | تعريف مبيعات متناقض | High | مؤكد (760≠89,350) | ✅ FIXED+DEPLOYED (توحيد) | مقارنة stats مع التقارير |
| BUG-10 | forgot-password | تحويل أثناء الجلسة | Low | مشتبه: تداخل auth state | ⚠️ OPEN | إرسال وأنت مسجل |
| BUG-11 | **middleware × process-queue/backfill** | 401 يقتل السلسلة الذاتية | **Critical** | مؤكد: whitelist ناقصة | ✅ FIXED+DEPLOYED — الاستخراج استؤنف 62→82 | kick بدون جلسة |
| BUG-12 | easyorders_webhook_events | تريغر مكسور يحجب كل UPDATE | **Critical** | مؤكد: `record "new" has no field "updated_at"` | ❌ **BLOCKED — شغّل 20240122000000** | أي تحديث على الجدول |
| BUG-13 | قيم enum ناقصة | إدراج سجلات مزامنة يفشل | Medium | مؤكد 22P02 | 🔧 STAGED (20240121) | إدراج webhook_attempt |
