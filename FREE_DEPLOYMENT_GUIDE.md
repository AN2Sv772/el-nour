# 🆓 El Nour Dashboard — دليل التشغيل المجاني 100%

## ملخص التكلفة: $0.00

| الخدمة | المزود | التكلفة | يحتاج بطاقة؟ |
|---------|--------|---------|-------------|
| استضافة Dashboard | Vercel | مجاني | ❌ لا |
| قاعدة البيانات | Supabase | مجاني | ❌ لا |
| الذكاء الاصطناعي (AI) | Groq | مجاني | ❌ لا |
| WhatsApp Worker | جهازك المحلي | مجاني | ❌ لا |
| Tunnel (ربط Worker) | Cloudflare | مجاني | ❌ لا |
| **الإجمالي** | | **$0.00** | ❌ **لا يحتاج أي بطاقة** |

---

## ⚡ الخطوات المطلوبة منك

---

### الخطوة 1: تشغيل الهجرة الجديدة في Supabase

**الوقت:** 2 دقيقة

1. افتح: https://supabase.com/dashboard/project/lyswmlmrlviptprhfiph/sql
2. اضغط **New Query**
3. افتح الملف التالي من جهازك:
```
/Volumes/1/el nour dashboard/el-nour-dashboard/supabase/migrations/20240106000000_production_features.sql
```
4. انسخ كامل محتواه والصقه في SQL Editor
5. اضغط **Run**
6. انتظر حتى تظهر `Success`

---

### الخطوة 2: الحصول على مفتاح Groq (مجاني 100%)

**الوقت:** 3 دقائق | **يحتاج بطاقة؟** ❌ لا

1. افتح: **https://console.groq.com/keys**
2. سجّل دخول بحساب Google (مجاني)
3. اضغط **"Create API Key"**
4. أعطه اسماً مثل `el-nour-dashboard`
5. اضغط **Submit**
6. **انسخ المفتاح** (يبدأ بـ `gsk_...`)

> 💡 Groq يعطيك **14,400 طلب/يوم مجاناً** — كافٍ لآلاف الردود
> 💡 النموذج `llama-3.3-70b-versatile` قوي جداً ويدعم العربية المصرية

---

### الخطوة 3: تشغيل WhatsApp Worker على جهازك (مجاني)

**الوقت:** 5 دقائق | **يحتاج بطاقة؟** ❌ لا

الـ Worker يعمل على **جهازك المحلي** — مجاني تماماً.

#### 3أ. تثبيت الـ Worker:

```bash
cd "/Volumes/1/el nour dashboard/el-nour-dashboard/whatsapp-worker"
npm install
```

#### 3ب. تشغيل الـ Worker:

```bash
# في terminal أول:
cd "/Volumes/1/el nour dashboard/el-nour-dashboard/whatsapp-worker"
bash start-free.sh
```

سترى:
```
[Worker] WhatsApp Worker running on port 3001
[WA] No saved session. Call POST /connect to start.
```

> ⚠️ **لا تغلق هذا الـ Terminal** — الـ Worker يجب أن يستمر بالعمل

#### 3ج. افتح Terminal ثاني (للـ Tunnel):

Cloudflare Tunnel يربط جهازك المحلي بالإنترنت — **مجاني بالكامل**:

```bash
# تثبيت cloudflared (مرة واحدة فقط):
brew install cloudflared

# تشغيل الـ Tunnel:
cloudflared tunnel --url http://localhost:3001
```

سيطبع لك رابط مثل:
```
https://xxx-xxx-xxx.trycloudflare.com
```

**انسخ هذا الرابط** — ستحتاجه في الخطوة التالية

---

### الخطوة 4: ربط الـ Worker بـ Dashboard

**الوقت:** دقيقة واحدة

1. افتح ملف `.env.local`:
```
/Volumes/1/el nour dashboard/el-nour-dashboard/.env.local
```

2. أضف أو حدّث هذين السطرين:
```env
WHATSAPP_WORKER_URL=https://xxx-xxx-xxx.trycloudflare.com
WORKER_API_KEY=local-free-worker-key-change-me
```

> ⚠️ الرابط يتغير كل مرة تشغّل الـ tunnel — يجب تحديثه في `.env.local`

3. احفظ الملف وأعد تشغيل السيرفر:
```bash
# Ctrl+C لإيقاف السيرفر القديم ثم:
npm run dev
```

---

### الخطوة 5: إعداد كل شيء من Dashboard

**الوقت:** 10 دقائق

#### 5أ. EasyOrders:
1. افتح: `http://localhost:3000/settings/integrations`
2. تبويب **EasyOrders**
3. الصق مفتاح API من easy-orders.net
4. اضغط **اختبار الاتصال** → ✅
5. اضغط **حفظ الإعدادات**
6. اضغط **مزامنة الآن**

> 💡 للحصول على مفتاح EasyOrders:
> - افتح https://easy-orders.net
> - سجّل دخول → الإعدادات → API / التطبيقات الخارجية
> - أنشئ مفتاح API جديد

#### 5ب. واتساب QR:
1. تبويب **واتساب**
2. اضغط **إنشاء رمز QR**
3. من موبايلك: WhatsApp ← الأجهزة المرتبطة ← ربط جهاز
4. امسح رمز QR من الشاشة

#### 5ج. المساعد الذكي (AI):
1. تبويب **AI**
2. اختر **Groq (مجاني 100%)** من القائمة
3. الصق مفتاح `gsk_...` من الخطوة 2
4. اكتب وصف نشاطك التجاري
5. اضغط **حفظ إعدادات AI**

#### 5د. قاعدة المعرفة:
1. تبويب **المعرفة**
2. أضف معلومات عملك:
   - الأسعار
   - الشحن
   - الدفع
   - أوقات العمل
3. الـ AI سيرد بناءً على هذه المعلومات فقط

---

### الخطوة 6: الاختبار

**الوقت:** 10 دقائق

#### اختبار الطلبات:
- اذهب لـ `/orders` — يجب أن ترى طلبات EasyOrders

#### اختبار واتساب:
- أرسل رسالة من موبايلك الشخصي لرقم العمل
- اذهب لـ `/inbox` — سترى الرسالة الواردة
- الـ AI سيرد تلقائياً خلال ثوانٍ

#### اختبار AI:
- أرسل "كم سعر الشحن؟" → يرد بمعلومة من قاعدة المعرفة
- أرسل "عايز أتكلم مع مدير" → يتوقف AI ويحوّل لموظف

---

## 🔄 التشغيل اليومي

كل يوم عند بدء العمل:

```bash
# Terminal 1: WhatsApp Worker
cd whatsapp-worker && bash start-free.sh

# Terminal 2: Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3001

# انسخ الرابط الجديد → حدّث .env.local → npm run dev
```

---

## 📋 ملخص الملفات المجانية

| الخدمة | المزود | حد الاستخدام المجاني |
|---------|--------|---------------------|
| Dashboard | Vercel | غير محدود (personal) |
| Database | Supabase | 500MB, 50K MAU |
| AI | Groq | 14,400 طلب/يوم |
| WhatsApp Worker | جهازك | غير محدود |
| Tunnel | Cloudflare | غير محدود |
| EasyOrders | حسب خطتك | حسب متجرك |

---

## ⚠️ حدود الحل المجاني

| القيد | الحل |
|--------|------|
| الـ Worker يتوقف عند إغلاق الكمبيوتر | شغّله عند بدء العمل كل يوم |
| Tunnel URL يتغير كل مرة | حدّث `.env.local` بعد تشغيل الـ tunnel |
| Groq أبطأ من OpenAI قليلاً | مقبول للردود التلقائية |
| Supabase Free = 500MB | كافٍ لآلاف الطلبات |
| Vercel Free = 100GB bandwidth | كافٍ للاستخدام الداخلي |

---

## 🆘 حل المشاكل

| المشكلة | الحل |
|----------|------|
| "Worker not reachable" | تأكد أن `start-free.sh` يعمل والـ tunnel مفتوح |
| QR لا يظهر | تأكد من تحديث `WHATSAPP_WORKER_URL` في `.env.local` بعد تشغيل tunnel جديد |
| AI لا يرد | تأكد من لصق مفتاح Groq الصحيح (يبدأ بـ `gsk_`) |
| EasyOrders لا يتصل | تأكد أن مفتاح API صحيح ولم تنته صلاحيته |
| الردود بطيئة | Groq أحياناً يكون مزدحماً — انتظر قليلاً وأعد المحاولة |
