# EL NOUR AUDIT — TEST LOG (live evidence)
Started: 2026-11-08
Tester: AI agent via Playwright (Chromium) + curl + Supabase REST
Test account: an2s.q.3@gmail.com (approved test account)
[DB-PRE] orders count via REST = 62 (backfill progressing)
[ORDERS-01] PASS — /orders auth OK, API 200, DB total=62, 20 rows/page rendered, data matches (EO-261110-2216, items embedded)
[ORDERS-02a] FAIL→FIXED — search 500: PGRST100 (embedded filter in .or() unsupported). Root cause confirmed from Vercel logs. Fix: two-stage search (customer ids → or(order_number, customer_id.in)). Local tests pass. DEPLOY PENDING (audit rule: no deploy — will verify after).
[ORDERS-02b] PASS — status filter (61 pending, all match), pagination (page 2 differs)
[ORDERS-03] PASS — order detail 200, matches list, items embedded, cost snapshot present, totals correct (100/130 with shipping)
[ORDERS-04] PASS — UI: 20 wa.me links, 20 checkboxes, export btn, search, filter all present
[ORDERS-05] PASS — bulk select works: label becomes "تصدير المحدد (2)"
[ORDERS-06] FAIL→FIXED — export 500: Arabic RTL marks (U+200F) in filename from ar-EG locale broke Content-Disposition ByteString. Fix: ASCII-sanitized filename + filename* UTF-8. (deploy pending)
[PRODUCTS-01] PASS — list 200, 9 products, imported products present (SKU synthesized EO-<uuid> because source has no SKU)
[PRODUCTS-02] PASS — create isolated test product 200
[PRODUCTS-03] PASS — cost edit 200 (cost 20→25)
[PRODUCTS-04a] FAIL→FIXED — stock adjust 500: code used movement_type/reason; REAL schema = type (enum in/out/adjustment/reserved/released) + notes. Fixed insert + UI display.
[PRODUCTS-04b] PASS — over-reduce safely blocked with Arabic Arabic error (400)
[RECON-01] PASS — preview 200: provisional from real data (1 order, 130 EGP, cogs 0 correct: imported product cost=0), shipping estimate 30 (real default from settings)
[RECON-02] FAIL (CRITICAL) — close-day 500 mid-way: reconciliation row created BUT inventory restore failed (prod still runs old movement_type code). NON-ATOMIC: partial state. Duplicate check then 409 (row exists). Cleanup: deleted partial test row (204). ROOT CAUSES: (a) prod not redeployed with schema fix (b) reconciliation POST is sequential inserts, not a DB transaction. FIX STAGED LOCALLY: RPC close function required.
[RECON-02b] PASS — duplicate close blocked 409 with Arabic message.
[RECON-03] FIX STAGED — atomicity: close_daily_reconciliation() RPC (single tx: row+items+movement+stock w/ row lock). API wired. Requires migration deploy.
[COLLECTIONS-01] PASS — batch created: expected 440 (2 orders − 10 deductions), received 440, diff 0, matched=true
[COLLECTIONS-02] PASS — allocated orders hidden from eligible picker (60 remain)
[COLLECTIONS-03] PASS — double allocation blocked 409 with Arabic message
[COLLECTIONS-04] PASS — unallocated/partial batch: expected 0, diff +100, unmatched (flagged for review)
[SETTINGS-01] FAIL (CRITICAL) — GET?type=business 500 AFTER successful PUT. ROOT CAUSE CONFIRMED: business_settings had 4 duplicate rows (upsert w/o conflict target creates new row each save; .single() then fails). Evidence: REST query showed 4 rows. FIX STAGED: singleton unique index migration + API reads latest/updates existing. Invalid save correctly rejected 400.
[SECURITY-01] PASS — unauthenticated API calls: 401 JSON (not HTML redirect) for /api/orders and /api/collections
[SECURITY-02] (running) RLS anon direct DB access per table
[DASHBOARD-01] FAIL(x2)→FIXED STAGED:
  (a) Backfill loses original created_at (violates "preserve timestamps") — FIX: set created_at from payload
  (b) Definition inconsistency: dashboard total_sales counted only delivered/shipped/confirmed (760) vs finance provisional_sales all non-cancelled (89,350) — same Arabic label "إجمالي المبيعات". FIX: unified definition (all non-cancelled). Existing production backfilled orders keep insert-time timestamps (data limitation, documented).
[AUTH-05] PARTIAL — forgot-password: logged-in user submitted → redirected to /dashboard instead of in-page success (auth-state interference); cannot verify email delivery without inbox access. NOT FULLY TESTED.
[DASHBOARD-02] FAIL→FIXED — /api/dashboard/top-products 500: order_items has NO created_at column; filtered via embedded orders.created_at. Live-caught in console.
[SETTINGS-02] FAIL→FIXED — /api/integrations/easyorders/webhook-attempts 500: inserted automation_log types not in automation_type ENUM (22P02). FIX: enum migration + enum-safe fallback types in code.
[VERIFY-FIXES] PASS — top-products 200 w/ real names (مساحة ارضيات بالبخاخ...), stats consistent (89,350), webhook-attempts 200 (20 records)
[SETTINGS-FINAL] PASS — load 200, save 200, reload 200 NO MORE 500 (singleton fix verified live)
[MOBILE-01] PASS (390px) — no horizontal overflow, menu button visible, RTL correct
[REMAINING] backfill continues autonomously (~61/1780 done at audit end, self-chaining)
