# RECONCILIATION VERIFICATION
## RPC Status: ❌ NOT DEPLOYED
`close_daily_reconciliation` function does NOT exist in production (PGRST202 confirmed via REST).
Migration file: `supabase/migrations/20240119000000_atomic_reconciliation.sql` (staged, not run).

## Current Production Behavior
- POST /api/reconciliation calls `.rpc('close_daily_reconciliation', {...})` → PGRST202 → 500
- **Reconciliation close is BLOCKED until user runs the migration**

## What IS verified in production
- GET /api/reconciliation (preview): 200, provisional stats from real data ✅
- Duplicate close guard: 409 with Arabic message ✅ (from non-RPC path)
- UI renders correctly with date picker ✅

## Atomicity Design (staged in migration)
The RPC does ALL of the following in a single transaction:
1. Duplicate close guard (SELECT + RAISE)
2. INSERT daily_reconciliations
3. Loop: INSERT daily_reconciliation_items + inventory_movements + UPDATE products.stock (FOR UPDATE lock)
4. All-or-nothing: any failure rolls back everything

## To unblock: Run `supabase/migrations/20240119000000_atomic_reconciliation.sql` in Supabase SQL Editor
