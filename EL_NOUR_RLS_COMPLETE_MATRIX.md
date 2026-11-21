# RLS COMPLETE MATRIX — All 31 Tables
**Test method:** Direct REST with anon role key (no session, no UI bypass)
**Result:** ALL 31 tables BLOCKED (HTTP 401/403) for anonymous role

| # | Table | RLS Enabled | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE |
|---|-------|-------------|-------------|-------------|-------------|-------------|
| 1 | orders | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 2 | order_items | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 3 | customers | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 4 | products | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 5 | user_profiles | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 6 | easyorders_config | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 7 | easyorders_sync_logs | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 8 | easyorders_webhook_events | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 9 | expenses | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 10 | daily_reconciliations | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 11 | daily_reconciliation_items | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 12 | collection_batches | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 13 | collection_deductions | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 14 | collection_allocations | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 15 | product_cost_history | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 16 | audit_log | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 17 | notifications | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 18 | saved_filters | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 19 | export_jobs | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 20 | import_jobs | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 21 | business_settings | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 22 | ai_config | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 23 | auto_reply_templates | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 24 | automation_logs | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 25 | inventory_movements | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 26 | order_status_history | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 27 | knowledge_base | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 28 | order_confirmation_settings | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 29 | order_confirmations | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 30 | order_confirmation_events | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| 31 | expense_categories | ✅ | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |

**Authenticated user (an2s.q.3@gmail.com):** Can read all tables, can write to authorized tables per role policies.
**Service role:** Full access (bypasses RLS by design — server-only).
**Cross-user:** Users can only see their own user_profiles row (auth.uid() = id policy).

**Verdict: RLS is correctly enforced on all 31 tables. Zero bypass found.**
