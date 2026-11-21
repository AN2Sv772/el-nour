# INVENTORY RESTORATION REPORT
## Schema (verified via OpenAPI)
`inventory_movements` columns: id, product_id, variant_id, **type** (enum: in/out/adjustment/reserved/released), quantity, reference_id, reference_type, **notes**, created_by, created_at

## Tests executed
| Test | Result | Evidence |
|------|--------|----------|
| Stock add +5 | ✅ PASS | 200, new_stock returned, persisted in DB |
| Stock reduce valid | ✅ PASS (code fixed) | type: 'out', notes populated |
| Over-reduce (999 > 10) | ✅ PASS | 400 blocked with Arabic error |
| Negative quantity | ✅ PASS | Math.abs clamps to positive |
| Non-existent product | ✅ PASS | 404 |

## Movement history verified
- type: 'in' for additions, 'out' for reductions
- notes: user-provided reason or default label
- created_by: auth.user.id from JWT
- Timestamp: DB NOW()

## Stock consistency
- Products API stock = DB stock = UI display ✅
- Over-reduce cannot produce negative stock ✅
- Restore via reconciliation: BLOCKED (RPC migration needed)
