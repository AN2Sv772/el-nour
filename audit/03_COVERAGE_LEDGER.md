# Coverage Ledger (20 units — all closed)

Machine-readable source: `~/security-audit-skill/el-nour-dashboard/run-1/coverage-ledger.json`
(validator `validate-coverage-ledger.cjs` → **PASS**, 20 units).

Every unit below was executed by the parent agent (`audit-parent`); the delegation backend
returned HTTP 529 on every attempt, which is recorded here rather than hidden.

| # | Surface | Boundary | Subsystem | Attack class | Status | Evidence |
|---|---|---|---|---|---|---|
| 1 | package.json#dependencies | package-lock.json#resolved versions | supply-chain | Chained vulnerabilities and trust boundaries | **covered** | pass (npm audit run, no critical/high advisories in producti |
| 2 | src/app/api/customers/route.ts#GET /api/customers | src/app/api/customers/route.ts#GET | src/app/api/customers | Injection | **covered** | fail-before-fix / pass-after-fix |
| 3 | src/app/api/dashboard/sales-chart/route.ts#GET /api/dashboard/sales-chart | src/app/api/dashboard/sales-chart/route.ts#resolveDateRange | src/app/api/dashboard | Business logic | **covered** | fail-before-fix / pass-after-fix |
| 4 | src/app/api/dashboard/top-products/route.ts#GET /api/dashboard/top-products | src/app/api/dashboard/top-products/route.ts#GET | src/app/api/dashboard | Resource and file handling | **covered** | fail-before-fix / pass-after-fix |
| 5 | src/app/api/expenses/route.ts#GET /api/expenses | src/app/api/expenses/route.ts#GET | src/app/api/expenses | Injection | **covered** | fail-before-fix / pass-after-fix |
| 6 | src/app/api/integrations/easyorders/catch-up/route.ts#GET /api/integrations/easyorders/catch-up | src/app/api/integrations/easyorders/catch-up/route.ts#requireRole | src/app/api/integrations/easyorders | Access control | **covered** | fail-before-fix / pass-after-fix |
| 7 | src/app/api/integrations/easyorders/import-test/route.ts#POST /api/integrations/easyorders/import-test | src/app/api/integrations/easyorders/import-test/route.ts#processWebhookEvent | src/app/api/integrations/easyorders | Business logic | **covered** | fail-before-fix / pass-after-fix |
| 8 | src/app/api/integrations/easyorders/route.ts#DELETE /api/integrations/easyorders | src/app/api/integrations/easyorders/route.ts#DELETE | src/app/api/integrations/easyorders | Business logic | **covered** | fail-before-fix / pass-after-fix |
| 9 | src/app/api/integrations/easyorders/webhook/route.ts#POST /api/integrations/easyorders/webhook | src/lib/easyorders/service.ts#verifyWebhookSecret | src/app/api/integrations/easyorders | Cryptography and secrets | **covered** | pass |
| 10 | src/app/api/integrations/order-confirmation/cron/route.ts#POST /api/integrations/order-confirmation/cron | src/app/api/integrations/order-confirmation/cron/route.ts#CRON_SECRET | src/app/api/integrations/order-confirmation | Access control | **covered** | fail-before-fix / pass-after-fix |
| 11 | src/app/api/orders/[id]/route.ts#DELETE /api/orders/:id | src/app/api/orders/[id]/route.ts#DELETE | src/app/api/orders | Business logic | **covered** | fail-before-fix / pass-after-fix |
| 12 | src/app/api/orders/route.ts#GET /api/orders | src/app/api/orders/route.ts#buildOrderQuery | src/app/api/orders | Injection | **covered** | fail-before-fix / pass-after-fix |
| 13 | src/app/api/reports/financial/route.ts#GET /api/reports/financial | src/app/api/reports/financial/route.ts#GET | src/app/api/reports | Injection | **covered** | fail-before-fix / pass-after-fix |
| 14 | src/app/dashboard/page.tsx#client data loading | src/app/dashboard/page.tsx#fetch | src/app | Feature abuse and data leakage | **covered** | pass |
| 15 | src/lib/crypto.ts#encryptSecret | src/lib/crypto.ts#getEncryptionKey | src/lib | Cryptography and secrets | **covered** | fail-before-fix / pass-after-fix (local key differs from pro |
| 16 | src/middleware.ts#public routes | src/middleware.ts#isPublicRoute | src/middleware.ts | Access control | **covered** | pass-after-fix |
| 17 | src/middleware.ts#rate limit | src/middleware.ts#checkRateLimit | src/middleware.ts | Resource and file handling | **covered** | partial (double-count claim rejected; unbounded store fixed) |
| 18 | supabase/migrations#row level security policies | supabase/migrations#app_role_rank | supabase | Feature abuse and data leakage | **covered** | pass |
| 19 | supabase/migrations/20260120000000_align_rls_with_app_roles.sql#easyorders_config privileges | supabase/migrations/20260120000000_align_rls_with_app_roles.sql#GRANT column privileges | supabase | Access control | **covered** | pass-after-fix |
| 20 | vercel.json#crons | vercel.json#crons | deployment | Business logic | **covered** | partial (one unregistered cron route found and fixed) |
