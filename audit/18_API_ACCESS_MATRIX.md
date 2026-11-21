# API Access Matrix — Production Baseline

Generated from `audit/evidence/api_probe_results.production.json` (the run against the
**production, pre-fix** build). Every cell is the observed HTTP status for that identity.

* `401` — no session / invalid session
* `403` — authenticated but the role is not sufficient
* `404` — the addressed resource does not exist
* `405` — the method is not implemented on that path
* `429` — the rate limiter refused the request
* `500` — the server failed (**F-002**: malformed input)
* `BLOCKED` — the probe was **not sent**: the safety guard refuses to transmit a request
  that can change production state (`AUDIT_ALLOW_DESTRUCTIVE=1` is required to run one)

The same matrix for the **repaired** build is in `audit/19_REMEDIATION_LOG.md` §4.

| Endpoint | anon | invalid cookie | viewer | employee | admin |
|---|---|---|---|---|---|
| `DELETE /api/collections` | 401 | 401 | 403 | 403 | 404 |
| `DELETE /api/expenses` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `DELETE /api/integrations/easyorders` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `DELETE /api/integrations/easyorders/webhook-config` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `DELETE /api/integrations/knowledge-base` | 401 | 401 | 403 | 403 | 200 |
| `DELETE /api/orders` | - | - | - | - | BLOCKED |
| `DELETE /api/orders/00000000-0000-0000-0000-000000000000` | 401 | 401 | 403 | 403 | 200 |
| `DELETE /api/products` | - | - | - | - | BLOCKED |
| `GET /api/collections` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/customers` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/dashboard/delivery-performance` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/dashboard/sales-chart` | 401 | 401 | 500 | 500 | 500 |
| `GET /api/dashboard/stats` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/dashboard/top-products` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/expenses` | 401 | 401 | 500 | 500 | 200 |
| `GET /api/export/excel` | - | - | - | - | 405 |
| `GET /api/integrations/easyorders` | 401 | 401 | 403 | 200 | 200 |
| `GET /api/integrations/easyorders/backfill` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `GET /api/integrations/easyorders/catch-up` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `GET /api/integrations/easyorders/process-queue` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `GET /api/integrations/easyorders/sync` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `GET /api/integrations/easyorders/webhook` | 405 | 405 | - | - | - |
| `GET /api/integrations/easyorders/webhook-attempts` | 401 | 401 | 403 | 200 | 200 |
| `GET /api/integrations/easyorders/webhook-config` | 401 | 401 | 403 | 403 | 200 |
| `GET /api/integrations/knowledge-base` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/integrations/order-confirmation` | 401 | 401 | 403 | 200 | 200 |
| `GET /api/integrations/order-confirmation/cron` | 401 | 401 | - | - | - |
| `GET /api/inventory/adjust` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/orders` | 401 | 401 | 500 | 500 | 500 |
| `GET /api/orders/00000000-0000-0000-0000-000000000000` | 401 | 401 | 404 | 404 | 404 |
| `GET /api/orders/stats` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/products` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/products/00000000-0000-0000-0000-000000000000` | 401 | 401 | 404 | 404 | 404 |
| `GET /api/reconciliation` | 401 | 401 | 200 | 200 | 200 |
| `GET /api/reports/financial` | 401 | 401 | 500 | 500 | 500 |
| `GET /api/settings` | 401 | 401 | 403 | 200 | 200 |
| `PATCH /api/orders/00000000-0000-0000-0000-000000000000` | 401 | 401 | 403 | 400 | 400 |
| `PATCH /api/products/00000000-0000-0000-0000-000000000000` | 401 | 401 | 403 | 404 | 404 |
| `POST /api/auth/register` | BLOCKED | BLOCKED | - | - | - |
| `POST /api/collections` | 401 | 401 | 403 | 400 | 400 |
| `POST /api/customers` | 429 | 429 | 429 | 429 | 429 |
| `POST /api/dashboard/stats` | - | - | - | - | 405 |
| `POST /api/expenses` | 401 | 401 | 403 | 400 | 400 |
| `POST /api/export/excel` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/integrations/easyorders/import-test` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/integrations/easyorders/process-queue` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/integrations/easyorders/sync` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/integrations/easyorders/test` | 401 | 401 | 403 | 403 | 200 |
| `POST /api/integrations/easyorders/webhook` | 200 | 200 | - | - | - |
| `POST /api/integrations/easyorders/webhook-config` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/integrations/knowledge-base` | 401 | 401 | 403 | 400 | 400 |
| `POST /api/integrations/order-confirmation/cron` | 401 | 401 | - | - | - |
| `POST /api/integrations/order-confirmation/resend` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/inventory/adjust` | 401 | 401 | 403 | 400 | 400 |
| `POST /api/orders` | 429 | 429 | 429 | 429 | 429 |
| `POST /api/orders/bulk` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `POST /api/orders/stats` | - | - | - | - | 405 |
| `POST /api/products` | 429 | 429 | 429 | 429 | 429 |
| `POST /api/reconciliation` | 401 | 401 | 403 | 400 | 400 |
| `PUT /api/collections` | 401 | 401 | 403 | 400 | 400 |
| `PUT /api/expenses` | 429 | 429 | 429 | 429 | 429 |
| `PUT /api/integrations/easyorders` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `PUT /api/integrations/knowledge-base` | 401 | 401 | 403 | 400 | 400 |
| `PUT /api/integrations/order-confirmation` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| `PUT /api/products` | - | - | - | - | 405 |
| `PUT /api/reconciliation` | 401 | 401 | 403 | 400 | 400 |
| `PUT /api/reports/financial` | - | - | - | - | 405 |
| `PUT /api/settings` | 401 | 401 | 403 | 403 | 400 |
