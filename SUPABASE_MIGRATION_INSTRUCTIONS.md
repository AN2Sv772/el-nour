# Supabase Migration Instructions

## Prerequisites
- Access to Supabase Dashboard for project `lyswmlmrlviptprhfiph`
- Service role key: set `SUPABASE_SERVICE_ROLE_KEY` in your local `.env.local` (never commit it — see `.env.example`)

## Migration Files (in order)
1. `supabase/migrations/20240101000000_initial_schema.sql` - Core schema
2. `supabase/migrations/20240102000000_fix_rls_policies.sql` - RLS policies
3. `supabase/migrations/20240103000000_atomic_order_function.sql` - Atomic order function
4. `supabase/migrations/20240104000000_fix_whatsapp_and_orders.sql` - WhatsApp & order fixes
5. `supabase/migrations/20240105000000_easyorders_integration.sql` - EasyOrders integration

## Combined Migration Script
A combined SQL file has been created at: `combined_migrations.sql`

## How to Run Migrations

### Option 1: Supabase Dashboard SQL Editor (Recommended)
1. Go to https://supabase.com/dashboard/project/lyswmlmrlviptprhfiph
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy and paste the entire contents of `combined_migrations.sql`
5. Click **Run** (or press Ctrl+Enter)
6. Wait for completion (may take 30-60 seconds)

### Option 2: Supabase CLI (if authenticated)
```bash
npx supabase db push --project-ref lyswmlmrlviptprhfiph
```

### Option 3: Supabase CLI with explicit password
```bash
npx supabase db push --project-ref lyswmlmrlviptprhfiph --password "YOUR_DB_PASSWORD"
```

## Post-Migration Verification

Run these queries in the SQL Editor to verify:

```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Verify enums
SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace;

-- Verify RLS enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;

-- Verify policies
SELECT schemaname, tablename, policyname, cmd, roles 
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

-- Verify functions
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';

-- Verify default data
SELECT * FROM business_settings;
SELECT * FROM ai_config;
SELECT * FROM auto_reply_templates;
SELECT * FROM business_settings WHERE order_workflow IS NOT NULL;
```

## Expected Results After Migration

- 22 tables created
- 15 custom enum types created
- 50+ RLS policies created
- 15+ triggers created
- 5+ functions created
- Default data seeded in `business_settings`, `ai_config`, `auto_reply_templates`

## Post-Migration Steps

1. **Create admin user profile**: After first user registers, manually update their role to 'admin':
   ```sql
   UPDATE user_profiles SET role = 'admin' WHERE email = 'your-admin-email@example.com';
   ```

2. **Configure WhatsApp**: Add real credentials in Settings → WhatsApp

3. **Configure EasyOrders**: Add API key in Settings → EasyOrders

## Troubleshooting

If migration fails:
1. Check for existing tables (run verification queries first)
2. Run migrations one at a time if combined script fails
2. Check for existing policies/constraints that may conflict
3. Ensure extensions (uuid-ossp, pgcrypto) are available
