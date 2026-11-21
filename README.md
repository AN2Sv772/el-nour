# El Nour Dashboard - WhatsApp Automation & Order Management

نظام متكامل لإدارة الطلبات، العملاء، المنتجات، ومحادثات واتساب مع ردود تلقائية ذكية.

## المميزات الرئيسية

### 📦 إدارة الطلبات
- إنشاء، تعديل، تتبع الطلبات
- حالات متعددة: قيد الانتظار، مؤكد، تم الشحن، تم التسليم، ملغي، مرتجع
- تتبع المخزون تلقائياً
- سجل تغييرات حالة الطلب

### 💬 صندوق رسائل واتساب
- محادثات فورية مع العملاء
- ردود تلقائية ذكية (AI)
- قوالب ردود قابلة للتخصيص
- تصعيد للموظفين البشريين
- دعم اللغتين العربية والإنجليزية

### 👥 إدارة العملاء
- ملفات عملاء شاملة
- تاريخ الطلبات والإنفاق
- وسوم وتصنيفات
- بحث وتصفية متقدمة

### 📦 إدارة المنتجات والمخزون
- منتجات مع متغيرات
- تتبع المخزون وتنبيهات النفاد
- فئات وأسعار مرنة
- استيراد/تصدير من Excel

### 📊 التقارير والتصدير
- تقارير المبيعات، الطلبات، العملاء، المنتجات
- تصدير Excel/CSV مع اختيار الأعمدة
- حماية من حقن الصيغ
- سجل تصدير

### ⚙️ الإعدادات
- إعدادات العمل (معلومات، رسوم، ضرائب)
- تكامل WhatsApp Cloud API
- تكوين الذكاء الاصطناعي
- مظهر مخصص

## التقنيات المستخدمة

- **Next.js 15** مع App Router و TypeScript
- **Tailwind CSS** للتصميم
- **Supabase** لقاعدة البيانات، المصادقة، والوقت الحقيقي
- **WhatsApp Business Cloud API** للمراسلة
- **XLSX** لتصدير Excel
- **Radix UI** للمكونات القابلة للوصول
- **Recharts** للرسوم البيانية

## المتطلبات

- Node.js 18+
- حساب Supabase
- حساب Meta Developer لـ WhatsApp Business API

## التثبيت والتشغيل

```bash
# استنساخ المشروع
git clone <repository-url>
cd el-nour-dashboard

# تثبيت التبعيات
npm install

# نسخ ملف البيئة وتعديله
cp .env.example .env.local

# تشغيل migrations قاعدة البيانات
# (في Supabase SQL Editor، نفذ محتوى supabase/migrations/20240101000000_initial_schema.sql)

# تشغيل خادم التطوير
npm run dev
```

## متغيرات البيئة

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# WhatsApp Business Cloud API
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token
WHATSAPP_APP_ID=your_app_id
WHATSAPP_APP_SECRET=your_app_secret

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## إعداد WhatsApp Webhook

1. في Meta Developer Console، اذهب إلى WhatsApp > Configuration
2. أضف Webhook URL: `https://your-domain.com/api/whatsapp/webhook`
3. ضع Verify Token مطابق لـ `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. اشترك في حقول: `messages`, `message_deliveries`, `message_reads`

## هيكل قاعدة البيانات

راجع `supabase/migrations/20240101000000_initial_schema.sql` للجداول:
- `customers` - العملاء
- `products` - المنتجات
- `orders` - الطلبات
- `order_items` - أصناف الطلبات
- `whatsapp_conversations` - محادثات واتساب
- `whatsapp_messages` - رسائل واتساب
- `auto_reply_templates` - قوالب الرد التلقائي
- `automation_logs` - سجلات الأتمتة
- `inventory_movements` - حركات المخزون
- `user_profiles` - ملفات المستخدمين
- `order_status_history` - تاريخ حالات الطلبات
- `notifications` - الإشعارات
- `saved_filters` - الفلاتر المحفوظة
- `export_jobs` / `import_jobs` - مهام الاستيراد/التصدير
- `ai_config` - إعدادات الذكاء الاصطناعي
- `business_settings` - إعدادات العمل
- `whatsapp_config` - إعدادات واتساب

## الأمان

- Row Level Security مفعل على جميع الجداول
- مفاتيح الخدمة فقط على الخادم
- التحقق من صحة البيانات بواسطة Zod
- حماية من CSRF و XSS
- تشفير البيانات الحساسة

## النشر

```bash
# بناء الإنتاج
npm run build

# تشغيل الإنتاج
npm start
```

للنشر على Vercel:
1. اربط المستودع بـ Vercel
2. أضف متغيرات البيئة
3. انشر

## الترخيص

MIT License - راجع ملف LICENSE للتفاصيل.

## الدعم

للاستفسارات والدعم التقني، يرجى فتح Issue في المستودع.