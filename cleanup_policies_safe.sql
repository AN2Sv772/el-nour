-- ============================================================================
-- SAFE PRE-MIGRATION CLEANUP: Drop only policies (safe anytime)
-- Run this FIRST in Supabase SQL Editor before running combined_migrations_fixed.sql
-- ============================================================================

-- Drop all policies on all tables (safe to run multiple times)
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

SELECT 'Policies cleaned up successfully' as status;
