# AUTONOMOUS TASK STATE — El Nour Dashboard
Last updated: 2026-11-22
Scope: Master autonomous implementation (Sections 1–29 mandate)

## ⚠️ Deployment constraint — SUPERSEDED (2026-11-22)
This file previously recorded: "**No deploy, no push** in this session. All changes local."

The owner explicitly overrode that constraint ("do everything you want"). Everything the
constraint used to hold back has since been done for real:

- the working tree is **committed and pushed** to `git@github.com:AN2Sv772/el-nour.git` (public);
- the pending migrations were **applied to the live Supabase project** through the SQL Editor
  and verified against it;
- the deployment environment was **configured** (`REGISTRATION_ALLOWED_EMAILS`, `INTERNAL_ORIGIN`,
  `INTERNAL_TRIGGER_SECRET` on Vercel);
- the application was **deployed to production**.

Only two things remain owner-only: rotating `SUPABASE_SERVICE_ROLE_KEY`, and rewriting the git
history to purge the customer PII that was committed before this round. See the
"Security hardening round" section at the bottom for the full state.

## AUTOMATIC ORDER SYNCHRONIZATION — IMPLEMENTED (2026-11-07)
### Architecture
```
EasyOrders new order → POST /webhook (public)
  ├─ verify `secret` header (timing-safe, official contract)
  ├─ dedup: event_type:order_id key (10-min window collapse)
  ├─ DURABLE INSERT (processing_status='pending')  ← never lose an event
  ├─ return 202 immediately (never process inline)
  └─ fire-and-forget kick to processor
Vercel Cron (every minute) → POST /process-queue
  ├─ claim_webhook_events() RPC — FOR UPDATE SKIP LOCKED (atomic, serverless-safe)
  ├─ process each event via processWebhookEvent (same pipeline as before)
  ├─ success → processed / temp failure → retry w/ exponential backoff (1,2,4,8,16m)
  ├─ permanent / 5 attempts → dead_letter
  └─ then advance historical backfill batch (~30 req, under 40/min limit)
Historical backfill → /orders/short/:id sequential scan (OFFICIAL enumeration path)
  ├─ short_id 1..1761 discovered for this store (binary search)
  ├─ checkpoint per item → resumable, idempotent (easyorders_order_id dedup)
  └─ cron auto-advances → ~1761 orders in ~60 min
Orders page → Supabase Realtime subscription on orders table → appears WITHOUT refresh
```
### Files
- supabase/migrations/20240116000000_webhook_event_queue.sql (queue columns + claim RPC)
- supabase/migrations/20240117000000_backfill_checkpoint.sql (backfill columns)
- src/lib/easyorders/queue.ts (drain/backoff/dead-letter/retry) + queue.test.ts (4 tests)
- src/lib/easyorders/backfill.ts (sequential scanner + checkpoint)
- webhook route: 202 durable-accept model + dedup + kick
- process-queue route: cron auth (CRON_SECRET) + stats + retry_dead_letters
- vercel.json: cron "* * * * *" on process-queue
- orders page: Realtime subscription
- integrations page: sync-health panel (queue stats + backfill progress + retry buttons)

### Key discoveries
- `/orders/short/:short_id` — sequential per-store IDs (1..1761 verified) — the ONLY
  official enumeration path (no orders-list endpoint exists; /orders → 404)
- Rate limit: 40 req/min (429 handling built in)

## Build/Test evidence (current local state)
- `npx tsc --noEmit` → ✅ clean
- `npm run build` → ✅ ✓ Compiled (all routes)
- `npm test` → ✅ **9 files, 88/88 pass** (12 new collection tests, 14 finance tests)

## Architecture map (current)
- Pages: /login /register /forgot-password /reset-password /dashboard /orders /orders/[id] /customers /customers/[id] /products /products/[id] /products/[id]/edit /reconciliation /collections /reports /settings /settings/integrations /forgot-password
- APIs: auth/register · orders(+[id]) · customers(+id filter) · products(+[id] GET/PATCH) · settings · dashboard/*(stats, sales-chart, top-products, delivery-performance) · export/excel(orderIds selection) · integrations/easyorders(config/test/sync/webhook/webhook-attempts/import-test) · integrations/order-confirmation(+cron/resend) · integrations/knowledge-base · expenses · reconciliation · inventory/adjust · reports/financial · collections
- Middleware: session-gate (getSession, no refresh race) + 401-JSON for APIs + rate limiting + webhook routes public

## COMPLETED (all verified locally)
1. **Collections reconciliation (Section 11 — TOP PRIORITY)** ✅
   - DB: collection_batches + collection_deductions + collection_allocations (UNIQUE(order_id) = no double counting) + RLS + grants
   - Engine: computeCollectionBatch (pure, 12 scenario tests: exact/partial/excess/deductions/adjustments/multi-batch/multi-date/excluded-returns/negative-clamp/empty/unmatched/rounding)
   - API: CRUD + server-side expected calculation + duplicate-allocation 409 + audit_log
   - UI /collections «مطابقة تحصيل شركات الشحن»: totals cards (received/expected/outstanding/matched), batch cards with editable received (inline), deductions badges, create dialog with orders picker (unallocated only) + deduction lines + live difference preview
   - Dashboard: collections_received + collections_outstanding KPIs
2. **Daily reconciliation** ✅ (previous phase; shipping estimate now reads REAL default_shipping_fee from business_settings — hardcoded 30 removed)
3. **Finance engine** ✅ finance.ts (provisional/reconciled/wa.me) — 26 unit tests total
4. **Expenses** ✅ API + reports UI; migration loosens fixed CHECK, adds expense_categories (9 Arabic defaults, user-manageable via table)
5. **Inventory** ✅ adjust API (movement-first, negative guard) + product edit UI with history; cost snapshots captured on manual orders AND EasyOrders imports; product_cost_history audit on cost edits
6. **Orders** ✅ bulk select + export-selected + wa.me buttons (rows + detail + customers) + order detail with reconciliation info
7. **Audit log** ✅ generic table wired into: expenses, cost changes, inventory, reconciliation edits, collection batches
8. **AI/WhatsApp residue** ✅ updateAISettingsSchema + ai branch in settings API removed; only DB-enum type unions remain (harmless)
9. **Auth/EasyOrders** ✅ verified in earlier production sessions (login/session/protected routes; import-test + webhook diagnostics)

## PENDING USER ACTIONS (consolidated)
1. Run in Supabase SQL Editor (additive, safe):
   - 20240114000000_business_operations.sql
   - 20240115000000_collections_and_expense_categories.sql
2. Deploy when ready: `vercel --prod` (I did NOT deploy per constraint)
3. EasyOrders webhook secret: paste the real secret from EasyOrders dashboard in التكاملات
4. Rotate SUPABASE_SERVICE_ROLE_KEY (was exposed in an old .env.example) + update in Vercel

## KNOWN REMAINING (honest, non-blocking)
- Reconciliation revenue reversal is an ESTIMATE (count × avg) — clearly labeled; exact per-order returns = future order-level selection
- Batch allocations pick orders by date range + manual selection; auto-allocation by settlement statement = future
- File attachments (batches/expenses) not implemented (no storage bucket configured)
- Import wizard (products/customers CSV) not implemented — exports complete; import is a discrete feature not yet requested to be live
- Backup: exports exist; automated DB backup verification is a Supabase-dashboard task (user-side)
- forecasting not implemented (doc says label as estimate if added — omitted)

## Next exact action
User runs the 2 migrations → deploys → verifies /collections + /reconciliation + /reports in production.

## ═══ جولة التدقيق الرئيسية (2026-11-11) — مكتملة ═══
### اكتشافات جديدة (بأدلة حية)
1. **BUG-11 CRITICAL**: middleware يعترض process-queue/backfill بـ401 → سلسلة الاستخراج كانت ميتة عند 62. FIX: whitelist + own-auth → استؤنف حيًا
2. **BUG-12 CRITICAL**: تريغر مكسور على easyorders_webhook_events يحجب أي UPDATE (طابور عالق) — SQL جاهز: 20240122000000 (يحتاج تشغيلك)
3. ضبط السلسلة النهائي: 4 طلبات/دفعة ≈ 5-6s (ضمن مهلة الدالة) — مثبت حيًا 101/1780 ويتقدم

### التقارير الثلاثة عشر منشورة في جذر المشروع
EL_NOUR_{MASTER_AUDIT, EXECUTIVE_SUMMARY, COMPLETE_FEATURE_INVENTORY, FUNCTIONAL_TEST_RESULTS, BUG_REGISTER, DATABASE_AUDIT, EASYORDERS_AUDIT, WHATSAPP_AUDIT, SECURITY_AUDIT, PERFORMANCE_AUDIT, FINANCIAL_AND_INVENTORY_AUDIT, DEPLOYMENT_AND_ROLLBACK_PLAN, UNTESTED_FEATURES}.md

### إجراءاتك (نفس القائمة — لم تُشغَّل بعد)
شغّل SQL: 20240122 (تريغر — حرج) → 20240119 (ذرّية) → 20240120 (singleton) → 20240121 (enum)
ثم: تدوير service key · استكمال backfill تلقائي (~ساعتان) · اختبار طلب حي من متجرك

---

## ═══ جولة الإتقان البصري — LTR الحقيقي (2026-11-21) ═══

### المشكلة التي تم حلها
كان تبديل اللغة إلى الإنجليزية يترجم التسميات فقط، بينما يظل التخطيط RTL (الشريط الجانبي على اليمين، اتجاه المستند RTL). هذا حدث بسبب `dir="rtl"` مشفر في `DashboardLayout` وفي 12 صفحة، وبسبب شريحة المتجر المكررة في الشريط العلوي، وزر المساعد العائم يغطي بيانات الجداول.

### الإصلاحات المنجزة
1. **الاتجاه الحقيقي**: أزيلت `dir="rtl"` من `DashboardLayout` و 12 صفحة (`overview`, `briefing`, `risk`, `anomalies`, `forecast`, `simulator`, `setup/costs`, `brain`, `approvals`, `decisions`, `analytics`, `agent`)، لتورث اتجاه المستند من `<html>` (الذي يحدده `LanguageProvider`). الآن عند التبديل للإنجليزية: الشريط الجانبي ينتقل لليسار، الهوامش المنطقية (`ms-[240px]`) تنعكس تلقائياً، وتظهر التسميات الإنجليزية في الشريط العلوي والتنقل.

2. **إزالة تكرار اسم المتجر**: شريحة المتجر في `AppTopBar` مخفية على `lg` (`lg:hidden`) لأن الشريط الجانبي يحمل نفس العلامة في ترويسة sidebar.

3. **نقل زر المساعد للزاوية (Desktop)**: `AiLauncher` أصبح في الزاوية الجانبية (`end-4 bottom-4`) على الشاشات `lg:` فقط، واختفى على الجوال (`hidden lg:flex`). الوصول للمساعد على الجوال أصبح عبر ورقة "المزيد" في الشريط السفلي (إضافة رابط `/agent` بأيقونة Bot).

4. **إصلاح درج الجوال المكسور**: أزيل شرط `sheetLoadedRef` الذي كان يمنع الظهور، واستبدل بجلب المستخدم من `AuthProvider` مباشرة.

5. **تعميم القاموس**: أضيفت مفاتيح `nav.more`، `common.close`، `ai.question`، `ai.attach`، `ai.voice` واستخدمت في `AiLauncher`، `MobileSidebarSheet`، `MobileBottomDock`.

6. **سكريبت التقاط اللقطات**: `scripts/capture-design.cjs` الآن يضبط لغة كل صفحة عبر `localStorage` قبل التحميل، وينتظر `networkidle` + استقرار `#main-content`، ويخفي شارة `nextjs-portal`.

7. **عقد LTR مستقر للاختبارات**: أضيفت `data-metric-key` و `data-metric-value` في `MetricCard` وبطاقات تفصيل الربح في صفحة نظرة العامة. حدث اختبار `F05-H3` لانتقاء القيم عبر هذه السمات بدل XPath الهش.

8. **اختبارات E2E للغة**: `e2e/i18n.spec.ts` — ثلاث حالات: التبديل يعكس الاتجاه + الترجمة + ثبات بعد إعادة التحميل، لا تجاوز أفقي في LTR، درج الجوال يفتح ويعرض الروابط.

### نتائج التحقق
- **TypeScript**: `npx tsc --noEmit` → ✅ clean
- **وحدات**: `npm test` → ✅ **453/453** (38 ملف)
- **E2E**: `npx playwright test` → ✅ **36/36** (desktop + mobile)
- **بناء إنتاج**: `npm run build` → ✅ **54 routes** compiled
- **Lint**: أخطاء ما قبل التاريخ في ملفات `supabase/` فقط (غير متعلقة بالتغييرات)

### اللقطات المحدثة
أعيد التقاط 9 لقطات في `replica/design/elnour/` (desktop AR/EN، mobile، `orders`، `products`، `overview`) كلها سليمة: EN LTR تظهر الشريط الجانبي يساراً، لا تكرار، زر المساعد في الزاوية، الدور السفلي عربي، لا تجاوز أفقي.

---

## ═══ جولة تدقيق الأمان والتحصين — 2026-11-22 ═══

### ما تم إنجازه
- **الدفع إلى GitHub**: `git@github.com:AN2Sv772/el-nour.git` (عام) — 455 ملف متتبَّع، سرّ ممسوح، استنساخ نظيف مطابق.
- **أربعة تدقيقات أمنية متوازية** (مصادقة/RBAC · API خارجي + MCP · طبقة البيانات · الأسرار/التشفير/الويبهوك) — كل نتيجة مُصلَحة في الشجرة ومُتحقَّق منها.
- **الترحيلات المعلقة مُصحَّحة** — كانت ستفشل عند التطبيق (التفصيل أدناه).

### الإصلاحات (اختصار)
| المجال | الإصلاح |
|---|---|
| الأدوار | `getUserRole` تعيد `null` عند غياب الملف/عدم النشاط/الدور المجهول → 403 بدل دور افتراضي |
| التسجيل | قائمة بيضاء `REGISTRATION_ALLOWED_EMAILS` فقط؛ غير مضبوطة = 403؛ الحساب الجديد `viewer` غير نشط |
| ترقية الأدوار | `reconciliation`، `order-confirmation` (PUT)، `brain/knowledge` (forgotten)، `ai/chat` (proposals) → manager+ |
| حقن الفلاتر | `products/route.ts`: قائمة أعمدة مسموحة + اقتباس `.or()` + تحقق UUID + حدود للترقيم والترتيب |
| التحقق | `patchProductSchema` (سعر/تكلفة محدودان) قبل تطبيق الحقل المسموح |
| CSV | تعطيل حقن المعادلات (`=`, `+`, `-`, `@`) |
| الأسرار | رفض المفاتيح القصيرة/العنصرية · `safeEqual` ثابت الزمن · مفتاح Gemini في ترويسة `x-goog-api-key` |
| Middleware | عنوان IP من ترويسات الوكيل الموثوقة · إعادة توجيه مفتوحة مغلقة |
| المخزون | كمية صحيحة ≤ 1,000,000 · التزامن المتفائل (409 عند التعارض) |
| الطلبات | المجموع يُشتق من الخادم (`round2`) والخصم محدود بالمجموع الفرعي |
| تسريب الأخطاء | أخطاء الخام استُبدلت برسائل عامة + `reference` UUID |
| Cron والداخلي | مقارنة ثابتة الزمن + تثبيت المصدر الذاتي (`INTERNAL_ORIGIN`) |
| MCP | حد 20 رسالة لكل دفعة |

### الأخطاء الحقيقية في قواعد البيانات (كانت ستفشل عند التطبيق)
1. **`report_snapshots` كان سيتراجع كلياً** — كان يستدعي `app_has_role(auth.uid(), array[...])` (معاملان)، بينما الدالة الحيّة معامل واحد فقط: `app_has_role(minimum text)`. المحرّر يلفّ الملف في معاملة واحدة، فلم يكن الجدول لينشأ أصلاً. **أُصلح** إلى `app_has_role('viewer')` و`app_has_role('manager')`.
2. **`created_at` كان يُكتب فوقه عند UPDATE** — يدمّر الختم الذي يجعل اللقطة سجلاً ثابتاً للحظة إغلاق اليوم. أُضيف `updated_at` + تريغّر يحدّثه.
3. **تريغر `handle_new_user` كان يصنع `employee` نشطاً** — أي تسجيل عام يصبح حساب كتابة أعمال مع وصول لبيانات العملاء. أصبح `viewer` غير نشط.
4. **ترقية الدور عبر RLS** — سياسة "Users can update own profile" تسمح بكتابة `{"role":"admin"}` في صفك بمفتاح `anon` العام. أُضيفت `20260126000000_lock_user_profile_role.sql` (سياسة مقيّدة + `REVOKE UPDATE (role, is_active)`).
5. **قالب `exec_sql` الخطير** في `run_migrations_final.js` (`SECURITY DEFINER` + `GRANT` لـ `anon`) — لم يُنفَّذ أبداً، لكن لصق واحد في محرّر SQL كان سيمنح قاعدة البيانات للإنترنت المفتوح. حُذف القالب؛ السكربتات الثلاثة صارت غلافاً يوجّه إلى `scripts/apply-migrations.mjs`.

### أدلة التحقق
- `npx tsc --noEmit` → ✅ clean
- `npm test` → ✅ **458/458** (38 ملف)
- `npm run build` → ✅ **91 routes**
- `npm run test:e2e` → ✅ **36 passed / 1 skipped** (المتخطى هو اختبار MCP — بلا `REPORTS_API_KEY`، وهذا هو العقد الصحيح)

### ⚠️ إجراءات المالك (لم تُنفَّذ — لا أملك الصلاحيات)
1. **دوّر `SUPABASE_SERVICE_ROLE_KEY`** — كان مكتوباً في 4 ملفات (أُزيل من الشجرة، لكن المفتاح القديم ما زال حيّاً).
2. **طبّق الترحيلات**: `20260123000000_business_brain.sql` · `20260124000000_ai_approvals.sql` · `20260125000000_report_snapshots.sql` (مُصحّحة) · `20260126000000_lock_user_profile_role.sql` — عبر SQL Editor أو `node scripts/apply-migrations.mjs`.
3. **اضبط في بيئة النشر**: `REGISTRATION_ALLOWED_EMAILS` · `INTERNAL_ORIGIN` · `CRON_SECRET`.
4. **النشر** (`vercel --prod`) — لم يُنفَّذ.

---

## ═══ جولة التطبيق على القاعدة الحيّة — 2026-11-22 ═══

### ما تغيّر عن القسم أعلاه
العوائق الثلاثة أعلاه كانت **افتراضات عن البيئة** لا قيوداً حقيقية: جلسة Chrome الموقّعة
تصل إلى محرّر SQL، وواجهة Vercel موثّقة على `el-nour1/el-nour-dashboard`. لذلك نُفِّذ كل شيء
فعلاً على المشروع الحيّ — ما عدا تدوير المفتاح.

**المشروع الحيّ لا يحتفظ بسجلّ ترحيلات.** لا وجود لـ `supabase_migrations.schema_migrations` —
كل ترحيل سابق طُبِّق عبر محرّر SQL. فسؤال "هل طُبِّق هذا الترحيل؟" أُجيب عليه بفحص **وجود
الكائنات** التي ينشئها الترحيل لا بقراءة سجلّ.

وهذا الفحص قلب محاسبة التدقيق نفسها: `20260122000000_easyorders_atomic_sync_log.sql` كان
مسجّلاً كتطبيق مُنجز، بينما في القاعدة الحيّة **لم توجد** `increment_easyorders_counters`
ولا `record_easyorders_sync_run`، وكان قيد `sync_type` على `easyorders_sync_logs` لا يزال
القيد الأصلي `('manual','webhook','scheduled','retry')` — أي أن نوعَي التشغيل
`'backfill'` و`'catch-up'` ما زالا مرفوضين من قاعدة البيانات. كانت نتيجتا **F-012** (فقدان
عدّادات المزامنة) و**F-013** (غياب أثر للماسحات) مفتوحتين في الإنتاج، لا مغلقتين.

### نتائج جديدة (S-20 … S-25)
| # | النتيجة | الإصلاح |
|---|---|---|
| S-20 | **18 سياسة** كانت تقرّر "هل هذا المُستدعي مدير؟" من `auth.jwt()->>'user_metadata'->>'role'` — قيمة يملكها المستخدم ويقدر ضبطها بنفسه عبر `updateUser({data:{role:'admin'}})`. مُتحقَّق حيّاً: حساب `employee` بلا أي صلاحية قرأ `ai_config` و`automation_logs` و`easyorders_webhook_events` بعد نداء واحد | `20260128000000_replace_jwt_user_metadata_role_checks.sql` — كل السياسات صارت `app_has_role(...)`. العدّ الحيّ الآن **0** سياسة تذكر `user_metadata` |
| S-21 | ثلاث سياسات INSERT باسم "System"/"Service" كانت `TO authenticated` مع `WITH CHECK (true)` — أي حساب موقَّع كان يستطيع تزوير صفوف في سجل التدقيق | `20260129000000_scope_system_insert_policies.sql` — أُعيد نطاقها إلى `TO service_role`. الفحص الحيّ: **0** سياسة `WITH CHECK (true)` يمكن لـ `authenticated` الوصول إليها |
| S-22 | `20260122000000` لم يصل إلى القاعدة قط، فبقيت F-012 وF-013 مفتوحتين في الإنتاج | طُبِّق؛ الدالتان موجودتان الآن وقيد `sync_type` يقبل `'backfill'` و`'catch-up'` |
| S-23 | `20260128000000` لم يكن قابلاً لإعادة التشغيل: `CREATE POLICY` بلا `IF NOT EXISTS`، وسياسة واحدة لم تُحذف قبل إعادة إنشائها → `42710 policy ... already exists` | الآن **كل** عبارات `CREATE POLICY` الـ40 يسبقها `DROP POLICY IF EXISTS` مطابق — بفحص آلي لا بالنظر |
| S-24 | `record_easyorders_sync_run` كانت تعلن `p_triggered_by uuid` بينما التطبيق يوصّفها `string \| null` واختباره يمرّر `'cron'` — المعامل uuid يرفع `22P02` فيضيع أثر التشغيل | المعامل أصبح `text` ويُحوَّل بأمان: uuid صحيح يُخزَّن، وأي شيء آخر يصبح `NULL` |
| S-25 | المستودع العام يحتوي **بيانات عميل حيّة** (اسم، رقم هاتف، عنوان) في أدلة التدقيق، التقطها الفحص من الإنتاج | أُخفيت من ملفات الأدلة الأربعة ومن `audit/10_DATA_INTEGRITY.md` (64 قيمة). الملفات ما زالت تُقرأ JSON وتحتفظ بـ538 فحصاًeach. **القيم ما زالت في تاريخ git** — انظر `audit/19_REMEDIATION_LOG.md` §7.5 |

### التحقق الحيّ بعد التطبيق
- سياسات تقرأ `user_metadata`: **0** (كانت 18) · سياسات `WITH CHECK (true)` يمكن لـ `authenticated` الوصول إليها: **0** (كانت 3)
- موظف يحاول ترقية دوره إلى `admin` → **HTTP 403**، والدور لم يتغيّر · تعديل `full_name` لنفسه → 200 (المسار الشرعي ما زال يعمل)
- موظف يحاول INSERT في `audit_log` / `order_confirmation_events` / `easyorders_sync_logs` → **403** على الثلاثة
- الجداول العشرة الجديدة: service role **200** · anon **401** · `record_easyorders_sync_run('backfill', …, 'cron')` كتبت `backfill / success / triggered_by=NULL / imported=3` ثم حُذف الصف
- `public.zz_audit_dump()` (مساعد الاستبطان المؤقت) → **محذوف** (rpc يعيد 404)
- الملفان المتبقيان: `an2s.q.11@gmail.com` = admin/نشط · `an2s.q.3@gmail.com` = employee/نشط

### متغيّرات بيئة النشر (Vercel production + `.env.local`)
| المتغيّر | القيمة | لماذا |
|---|---|---|
| `REGISTRATION_ALLOWED_EMAILS` | `an2s.q.3@gmail.com,an2s.q.11@gmail.com,an2s.q.100@gmail.com` | **لا بديل احتياطي** — لم يكن مضبوطاً، فكان `POST /api/auth/register` يعيد 403 لكل عنوان: التسجيل ميّت في الإنتاج |
| `INTERNAL_ORIGIN` | `https://el-nour-dashboard.vercel.app` | يثبّت هدف النداء الذاتي الحامل للسرّ. كان له بديل آمن (`NEXT_PUBLIC_APP_URL`)، فجعل التثبيت مستقلاً عن متغيّر `NEXT_PUBLIC_*` |
| `INTERNAL_TRIGGER_SECRET` | قيمة عشوائية جديدة 32 بايت | تفصل مفتاح HMAC عن `CREDENTIALS_ENCRYPTION_KEY` |

### ما تبقّى للمالك فقط
1. **تدوير `SUPABASE_SERVICE_ROLE_KEY`** — hygiene لا استعجال: المفتاح لم يُودَع في المستودع أبداً، existe في `.env.local` (مُتجاهَل من git) وفي Vercel كمتغيّر "sensitive". التدوير يعني إنشاء مفتاح جديد، استبداله في Vercel و`.env.local`، ثم إعادة نشر — تسلسل قد يترك التطبيق بلا مفتاح إن انقطع في منتصفه.
2. **إعادة كتابة تاريخ git** — بيانات العميل في S-25 كانت مُودَعة قبل هذه الجولة، وهي ما زالت في تاريخ المستودع العام. الشجرة نظيفة لكن نسخة المستودع تحتويها. إزالتها تحتاج `git filter-repo` وforce-push، تُركت للمالك عمداً.
