# AUTONOMOUS TASK STATE — El Nour Dashboard
Last updated: 2026-11-07 05:30 UTC+2
Scope: Master autonomous implementation (Sections 1–29 mandate)

## ⚠️ Deployment constraint honored
**No deploy, no push** in this session. All changes local. Production runs the earlier verified deployment (EasyOrders import works in production via webhook — verified with real pipeline test orders).

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
