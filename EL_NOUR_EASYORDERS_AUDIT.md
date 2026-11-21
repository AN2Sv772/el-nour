# EL_NOUR_EASYORDERS_AUDIT.md — تدقيق تكامل EasyOrders (حية بالكامل)

## المسار الموثق (مُختبر حيًا من الطرفين)
```
متجرك (3fb15a96…) ──طلبات حقيقية──▶ /orders/short/:id (تسلسلي 1..1780)
                                  └▶ Webhook POST /webhook (secret header)
                                        ├─ timing-safe verify → 401 عند الخطأ (مُختبر)
                                        ├─ dedup key event:order_id (نافذة 10د)
                                        ├─ إدخال دائم pending → 202 فورًا
                                        └─ after(): تشغيل المعالج
المعالج الذاتي (بدون cron — خطة Hobby):
  claim ذرّي (test-and-set) → معالجة → backoff أُسّي 1,2,4,8,16د → dead_letter×5
  ثم دفعة backfill (5 طلبات ضمن مهلة 10s) → after() → الدفعة التالية → …
```

## نتائج المطابقة source→destination (حية)
| المؤشر | القيمة وقت التدقيق |
|--------|--------------------|
| طلبات المتجر المكتشفة (binary search على short_id) | 1780 |
| المستوردة فعليًا (عدّ REST مستقل) | 82 ومتزايد |
| فشل أول 30 (قبل إصلاح SKU) | تعاد بضغطة (idempotent dedup) |
| تكرار طلبات | صفر (ثلاث طبقات: dedup_key + easyorders_order_id فحص + UNIQUE) |
| أحداث عالقة | 2 (تريغر مكسور — SQL جاهز) |

## الاتصال
- GET /products بمفتاحك → 200 + store_id (المسار الرسمي للتحقق — /stores/me غير موجود)
- key rotation → is_connected=false تلقائيًا حتى إعادة الاختبار (سلوك أمني مقصود، مُختبر)

## الحدود الرسمية الموثقة (لا اختلاق)
- لا يوجد endpoint لسرد الطلبات — الاستخراج عبر short_id التسلسلي فقط
- rate limit 40/دقيقة (429 مُعالَج في الكود)
- الحدث الحي من متجرك يتطلب: طلبًا جديدًا فعليًا + رابط الويب هوك مُضبوطًا في لوحة البائع:
  https://el-nour-dashboard.vercel.app/api/integrations/easyorders/webhook
