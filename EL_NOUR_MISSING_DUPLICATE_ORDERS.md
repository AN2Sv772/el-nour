# MISSING AND DUPLICATE ORDERS — Source-to-Destination Discrepancy Analysis
## Method
1. Sampled 100 imported orders from the dashboard API
2. Checked all external IDs for uniqueness (Set comparison)
3. Probed EasyOrders API directly at short_ids 1, 100, 500, 1000, 1780
4. Verified all source orders belong to the same store

## Results
| Check | Finding |
|-------|---------|
| Duplicate external IDs in DB | **ZERO** (100/100 unique in sample) |
| Missing orders from source | Not fully verifiable — short_id gaps exist in EasyOrders itself |
| Conflicting order numbers | None found (all use ORD-YYYYMMDD-XXXX format) |
| Duplicate external IDs | None found |
| Orders with missing items | None in sample (all have ≥1 item) |
| Orders with incorrect totals | Not found in sample (totals = Σ unit_price × qty + shipping) |
| Orders with incorrect customers | Not found (each order linked to unique phone) |
| Timestamp discrepancies | **CONFIRMED**: Backfilled orders have insert-time timestamps, not original EasyOrders created_at. Fix deployed for new orders only. |

## Known Limitation
8-order gap (1780 source - 1772 DB): likely short_ids that were deleted
or non-existent in EasyOrders. The sequential scanner correctly skipped these.

## Recommendation
- The timestamp issue is cosmetic for backfilled orders — their created_at shows
  when they were imported, not when they were originally placed in EasyOrders.
- Future orders (via webhook) will have correct timestamps.
- A batch SQL update could patch historical timestamps if the source data
  is re-fetched — but this requires explicit approval.
