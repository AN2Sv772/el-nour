# EL_NOUR_FINAL_BLOCKERS.md — All Remaining Blockers

## BLOCKER 1 (CRITICAL): RPC close_daily_reconciliation NOT deployed
- **Impact:** Reconciliation close returns 500 on POST
- **Migration:** supabase/migrations/20240119000000_atomic_reconciliation.sql
- **Action:** Run in Supabase SQL Editor
- **Verify:** POST /api/reconciliation should return 200 instead of 500

## BLOCKER 2 (CRITICAL): Webhook events trigger broken
- **Impact:** Any UPDATE on easyorders_webhook_events fails (22P02: record "new" has no field "updated_at")
- **Effect:** Queue events stuck in 'pending' — cannot transition to 'processed'
- **Migration:** supabase/migrations/20240122000000_fix_webhook_events_trigger.sql
- **Action:** Run in Supabase SQL Editor (adds updated_at column + recreates trigger)

## BLOCKER 3 (HIGH): business_settings singleton constraint missing
- **Impact:** 4 duplicate rows exist; new saves may create more (API workaround deployed)
- **Migration:** supabase/migrations/20240120000000_business_settings_singleton.sql
- **Action:** Run in Supabase SQL Editor (deletes dupes + adds unique index)

## BLOCKER 4 (MEDIUM): automation_type enum missing webhook values
- **Impact:** Webhook lifecycle log entries fail with 22P02 (code workaround deployed)
- **Migration:** supabase/migrations/20240121000000_automation_type_values.sql
- **Action:** Run in Supabase SQL Editor

## NON-BLOCKING (recommended)
- Rotate SUPABASE_SERVICE_ROLE_KEY (was exposed in .env.example)
- Configure webhook URL in EasyOrders seller dashboard (for real live orders)
- Create a test order in the store to verify live webhook
- Consider Vercel Pro for minute-level cron jobs (current: self-chaining only)
