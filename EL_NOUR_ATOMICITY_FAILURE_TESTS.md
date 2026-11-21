# ATOMICITY AND FAILURE INJECTION TESTS
## Status: ⚠️ PARTIAL (RPC migration not run in production)

## What is verified
| Scenario | Current behavior | Expected after RPC | Status |
|----------|-----------------|-------------------|--------|
| Normal close | 500 (RPC missing) | 200 + all records | BLOCKED |
| Duplicate close | 409 Arabic message | 409 | ✅ PASS |
| Concurrent close | UNIQUE(business_date) constraint | Same | ✅ Designed |
| Failure during item insert | Sequential: reconciliation row + partial items remain | All rollback | ❌ FAIL (current) |
| Failure during movement | Same as above | All rollback | ❌ FAIL (current) |

## Current Production Risk
Without the RPC migration, a mid-close failure can leave:
- An orphaned daily_reconciliations row
- Missing reconciliation_items
- Missing inventory_movements
- Un-restored stock
This was CONFIRMED during the previous audit (partial row found, cleaned up manually).

## RPC Design (staged)
`close_daily_reconciliation()` in `20240119000000_atomic_reconciliation.sql`:
- DECLARE v_rec_id UUID
- Guard: SELECT id → IF EXISTS RAISE EXCEPTION
- INSERT reconciliation → RETURNING id INTO v_rec_id
- FOR each item: INSERT item → INSERT movement → SELECT stock FOR UPDATE → UPDATE stock
- RETURN v_rec_id
- ALL within single implicit transaction → automatic rollback on any error

## To verify after migration runs
1. POST /api/reconciliation with valid data → should return 200 + all records
2. Inject failure (e.g. invalid product_id) → should return 500 + NO partial records
3. Duplicate close → should return 409
4. Concurrent close → second request gets 409
