# ROLE PERMISSION MATRIX
## Discovered roles (from user_profiles.role column + RLS policies)
| Role | Users | Capabilities |
|------|-------|-------------|
| admin | 0 (none created) | Full access per RLS policies |
| manager | 0 (none created) | Manage orders, products, collections, reconciliation, expenses |
| employee | 2 (anas + audit-test) | View orders/customers/products, create orders, view configs |
| viewer | 0 (none created) | View only |

## Application-level checks (verified in production)
| Feature | employee (anas) | anon |
|---------|-----------------|------|
| Dashboard access | ✅ | ❌ 307→login |
| Orders read | ✅ 200 | ❌ 401 |
| Orders create | ✅ 200 | ❌ 401 |
| Orders update | ✅ 200 | ❌ 401 |
| Customers read | ✅ 200 | ❌ 401 |
| Products read | ✅ 200 | ❌ 401 |
| Inventory adjust | ✅ 200 | ❌ 401 |
| Collections read/create | ✅ 200 | ❌ 401 |
| Reconciliation read | ✅ 200 | ❌ 401 |
| Reconciliation close | ⚠️ 500 (RPC missing) | ❌ 401 |
| Settings read | ✅ 200 | ❌ 401 |
| Settings save | ✅ 200 | ❌ 401 |
| EasyOrders config read | ✅ 200 | ❌ 401 |
| EasyOrders config save | ✅ 200 | ❌ 401 |
| Export | ✅ 200 | ❌ 401 |
| Register | N/A | ✅ 200 |
| Webhook | N/A | ✅ 202 (secret-verified) |

**Note:** The application has ONE effective role in production (employee). Admin/manager RLS policies exist but no users with those roles. The role escalation path (admin can manage all profiles) exists in RLS but requires an admin to set another user's role — no UI for this exists.
