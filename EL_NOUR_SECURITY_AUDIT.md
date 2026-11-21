# EL_NOUR_SECURITY_AUDIT.md — تدقيق الأمان

## مُختبر وناجح
| الفحص | النتيجة | الدليل |
|-------|---------|--------|
| API بدون جلسة | 401 JSON (ليس HTML) | /api/orders, /api/collections |
| صفحات بدون جلسة | 307 → /login?redirectTo | /dashboard, /collections |
| RLS دور anon مباشرة (REST) | 401/مرفوض على 7 جداول | orders, customers, products, user_profiles, easyorders_config, expenses, daily_reconciliations |
| Webhook secret خاطئ/مفقود | 401 | timing-safe compare |
| أسرار في الاستجابات | مُقنَّعة (93a4••••2fcc) | GET config |
| تصدير | مصادقة + تعقيم formula-injection موجود | sanitizeCellText |
| معلومات الأخطاء | رسائل عربية عامة؛ التفاصيل في logs الخادم فقط | استجابات 4xx/5xx |

## ملاحظات ومخاطر متبقية
| # | المخاطرة | الخطورة | الإجراء |
|---|----------|---------|---------|
| 1 | SUPABASE_SERVICE_ROLE_KEY كُشف تاريخيًا في .env.example | **High** | دوّره الآن + حدّثه في Vercel |
| 2 | whitelist الميدلوير يشمل process-queue/backfill (auth خاصة بها: trigger/cron) | Medium | مقصود وموثق؛ CRON_SECRET موصى به |
| 3 | rate limiting في الذاكرة (خادم بلا حالة) | Low | موثق؛ يكفي للحجم الحالي |
| 4 | تسجيل أخطاء backfill قد يتضمن message من DB | Low | لا أسرار فيه (رسائل PostgREST) |
