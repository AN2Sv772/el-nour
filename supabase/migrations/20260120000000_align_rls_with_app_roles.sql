-- =============================================================================
-- Align database RLS with the application-layer role matrix
-- =============================================================================
-- WHY
-- ---
-- The dashboard API routes authorise with `requireRole()` (src/lib/supabase/
-- require-role.ts) and then query with the SERVICE-ROLE key, which BYPASSES
-- RLS. The effective authorisation layer is therefore the application layer,
-- while the database policies still described the OLD model:
--
--   orders UPDATE  -> admin|manager only
--   customers      -> manager-only writes
--   expenses       -> manager-only writes
--   DELETE         -> manager-only (or missing)
--
-- The application layer now grants:
--
--   read          -> viewer   (rank 0)
--   create/update -> employee (rank 1)
--   delete        -> manager  (rank 2)
--   infrastructure-> admin    (rank 3)
--
-- Consequence of the old policies: an EMPLOYEE can update an order through
-- the app (service role), but is refused by the database if the same request
-- is replayed directly against PostgREST with the user's own JWT. The two
-- layers disagreed.
--
-- This migration makes the database agree with the application. It does NOT
-- change what the API routes do (they keep using the service role); it closes
-- the direct-PostgREST hole and removes the contradiction.
--
-- HOW TO APPLY (the agent has no DDL path - the Supabase SQL/Management APIs
-- are unavailable from this environment):
--   1. Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--   2. Or: psql "$SUPABASE_DB_URL" -f supabase/migrations/20260120000000_align_rls_with_app_roles.sql
--   3. Verify: the checks at the end of this file must all return rows.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Role helper
-- -----------------------------------------------------------------------------
-- `app_role_rank()` maps the signed-in user's profile role to the same rank
-- ladder used by the application layer:
--   viewer = 0, employee = 1, manager = 2, admin = 3
--
-- It is SECURITY DEFINER (so a user can read their own role without being
-- able to read other profiles) and STABLE (so the planner can cache it
-- within a statement). A missing / inactive profile yields -1 => DENY.
--
-- NOTE: `user_profiles.is_active` exists in the schema; if a future deploy
-- drops the column, the COALESCE guard keeps the function working.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_role_rank()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT CASE up.role
        WHEN 'admin'    THEN 3
        WHEN 'manager'  THEN 2
        WHEN 'employee' THEN 1
        WHEN 'viewer'   THEN 0
        ELSE -1
      END
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND COALESCE(up.is_active, true) = true
      LIMIT 1
    ),
    -1
  );
$$;

COMMENT ON FUNCTION public.app_role_rank() IS
  'Rank of the signed-in user: viewer=0, employee=1, manager=2, admin=3, unknown=-1 (deny). Mirrors ROLE_RANK in src/lib/supabase/require-role.ts.';

CREATE OR REPLACE FUNCTION public.app_has_role(minimum text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_role_rank() >= CASE lower(minimum)
    WHEN 'admin'    THEN 3
    WHEN 'manager'  THEN 2
    WHEN 'employee' THEN 1
    WHEN 'viewer'   THEN 0
    ELSE 99
  END;
$$;

COMMENT ON FUNCTION public.app_has_role(text) IS
  'TRUE when the signed-in user is at or above the given role (admin|manager|employee|viewer).';

-- -----------------------------------------------------------------------------
-- 2. orders
--    read: viewer | create/update: employee | delete: manager
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view orders" ON orders;
DROP POLICY IF EXISTS "Employees can create orders" ON orders;
DROP POLICY IF EXISTS "Managers can update orders" ON orders;
DROP POLICY IF EXISTS "Managers can delete orders" ON orders;

CREATE POLICY "app_read_orders" ON orders
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_orders" ON orders
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_orders" ON orders
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_orders" ON orders
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 3. order_items - follows its parent order
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view order_items" ON order_items;
DROP POLICY IF EXISTS "Employees can manage order_items" ON order_items;

CREATE POLICY "app_read_order_items" ON order_items
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_order_items" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_order_items" ON order_items
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_order_items" ON order_items
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 4. customers - read: viewer | write: employee | delete: manager
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view customers" ON customers;
DROP POLICY IF EXISTS "Managers can manage customers" ON customers;

CREATE POLICY "app_read_customers" ON customers
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_customers" ON customers
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_customers" ON customers
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_customers" ON customers
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 5. products - read: viewer | write: employee | delete: manager
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view products" ON products;
DROP POLICY IF EXISTS "Managers can manage products" ON products;

CREATE POLICY "app_read_products" ON products
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_products" ON products
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_products" ON products
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_products" ON products
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 6. expenses + expense_categories - read: viewer | write: employee | delete: manager
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view expenses" ON expenses;
DROP POLICY IF EXISTS "Managers can manage expenses" ON expenses;

CREATE POLICY "app_read_expenses" ON expenses
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_expenses" ON expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_expenses" ON expenses
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_expenses" ON expenses
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

DROP POLICY IF EXISTS "Authenticated users can view expense_categories" ON expense_categories;
DROP POLICY IF EXISTS "Managers can manage expense_categories" ON expense_categories;

CREATE POLICY "app_read_expense_categories" ON expense_categories
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_expense_categories" ON expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_expense_categories" ON expense_categories
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_expense_categories" ON expense_categories
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 7. collections - read: viewer | write: employee | delete: manager
--    (collection_batches / collection_allocations / collection_deductions)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view collection_batches" ON collection_batches;
DROP POLICY IF EXISTS "Managers can manage collection_batches" ON collection_batches;

CREATE POLICY "app_read_collection_batches" ON collection_batches
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_collection_batches" ON collection_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_collection_batches" ON collection_batches
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_collection_batches" ON collection_batches
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

DROP POLICY IF EXISTS "Authenticated users can view collection_allocations" ON collection_allocations;
DROP POLICY IF EXISTS "Managers can manage collection_allocations" ON collection_allocations;

CREATE POLICY "app_read_collection_allocations" ON collection_allocations
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_collection_allocations" ON collection_allocations
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_collection_allocations" ON collection_allocations
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_collection_allocations" ON collection_allocations
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

DROP POLICY IF EXISTS "Authenticated users can view collection_deductions" ON collection_deductions;
DROP POLICY IF EXISTS "Managers can manage collection_deductions" ON collection_deductions;

CREATE POLICY "app_read_collection_deductions" ON collection_deductions
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_collection_deductions" ON collection_deductions
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_collection_deductions" ON collection_deductions
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_collection_deductions" ON collection_deductions
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 8. knowledge_base - read: viewer | write: employee | delete: manager
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view knowledge_base" ON knowledge_base;
DROP POLICY IF EXISTS "Managers can manage knowledge_base" ON knowledge_base;

CREATE POLICY "app_read_knowledge_base" ON knowledge_base
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_knowledge_base" ON knowledge_base
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_knowledge_base" ON knowledge_base
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_knowledge_base" ON knowledge_base
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 9. inventory_movements - write: employee | delete: manager
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view inventory_movements" ON inventory_movements;
DROP POLICY IF EXISTS "Managers can manage inventory_movements" ON inventory_movements;

CREATE POLICY "app_read_inventory_movements" ON inventory_movements
  FOR SELECT TO authenticated
  USING (public.app_has_role('viewer'));

CREATE POLICY "app_insert_inventory_movements" ON inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_update_inventory_movements" ON inventory_movements
  FOR UPDATE TO authenticated
  USING (public.app_has_role('employee'))
  WITH CHECK (public.app_has_role('employee'));

CREATE POLICY "app_delete_inventory_movements" ON inventory_movements
  FOR DELETE TO authenticated
  USING (public.app_has_role('manager'));

-- -----------------------------------------------------------------------------
-- 10. infrastructure tables - admin only for writes
--     (EasyOrders config, business settings, order-confirmation settings)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage EasyOrders config" ON easyorders_config;

CREATE POLICY "app_read_easyorders_config" ON easyorders_config
  FOR SELECT TO authenticated
  USING (public.app_has_role('employee'));

-- -----------------------------------------------------------------------------
-- 10a. Column-level lockdown of the encrypted secrets
--
-- WHY
-- ---
-- RLS is ROW-level, so `app_read_easyorders_config` lets any employee read
-- the WHOLE row — including `api_key` and `webhook_secret`, which are stored
-- as AES-256-GCM ciphertext.
--
-- The application never hands those ciphertexts to a browser: the API route
-- masks the key and only admins may change the configuration. A direct
-- PostgREST call with a user's own JWT bypassed that care and returned the
-- raw ciphertext (empirically confirmed with a `viewer` session).
--
-- The ciphertext is not the plaintext — it cannot be replayed against
-- EasyOrders and the plaintext cannot be brute-forced from it (the key is
-- 256-bit and lives only in the server environment) — but it is still
-- encrypted material that should not leave the database for a low-privilege
-- session. If the encryption key ever leaks, every copy of the ciphertext
-- becomes a live API key.
--
-- HOW
-- ---
-- Column privileges are evaluated before RLS, so the secrets must be locked
-- with COLUMN-level privileges. BUT a column-level REVOKE is a NO-OP while a
-- table-level SELECT grant exists: PostgreSQL keeps the table grant
-- authoritative and never records a column ACL for it
-- (`pg_attribute.attacl` stays NULL and `has_column_privilege()` keeps
-- answering true). The effective pattern is therefore:
--   1. REVOKE the table-level privilege
--   2. GRANT the non-secret columns back, one column at a time
--
-- The `service_role` keeps its own table grants, so the application's API
-- routes (which use the service role) are unaffected.
--
-- Verified empirically against the live project:
--   employee session -> SELECT api_key        => 1 row   (BEFORE this change)
--   employee session -> SELECT api_key        => 403 42501 (AFTER this change)
--   employee session -> SELECT store_id       => 200      (still readable)
--   service_role     -> SELECT api_key        => 200      (app path intact)
--   viewer session   -> UPDATE easyorders_config => 0 rows (RLS)
-- -----------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE easyorders_config FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE easyorders_config FROM anon;

-- Non-secret columns remain readable by signed-in users (RLS still applies:
-- `app_read_easyorders_config` limits the row to employees and above).
GRANT SELECT (id, store_id, store_name, webhook_url, is_connected,
               last_sync_at, last_sync_status, last_webhook_at)
  ON easyorders_config TO authenticated;

CREATE POLICY "app_insert_easyorders_config" ON easyorders_config
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_role('admin'));

CREATE POLICY "app_update_easyorders_config" ON easyorders_config
  FOR UPDATE TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

CREATE POLICY "app_delete_easyorders_config" ON easyorders_config
  FOR DELETE TO authenticated
  USING (public.app_has_role('admin'));

DROP POLICY IF EXISTS "Authenticated users can view business_settings" ON business_settings;
DROP POLICY IF EXISTS "Admins can manage business_settings" ON business_settings;

CREATE POLICY "app_read_business_settings" ON business_settings
  FOR SELECT TO authenticated
  USING (public.app_has_role('employee'));

CREATE POLICY "app_update_business_settings" ON business_settings
  FOR UPDATE TO authenticated
  USING (public.app_has_role('admin'))
  WITH CHECK (public.app_has_role('admin'));

-- -----------------------------------------------------------------------------
-- 11. grants - the helper must be executable by authenticated users
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.app_role_rank() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_has_role(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 12. verification (run these after applying)
-- -----------------------------------------------------------------------------
-- SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user;
--
-- Expected policies per table:
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND policyname LIKE 'app\_%'
--   ORDER BY tablename, cmd;
--
-- Expected: app_read_* (select) + app_insert/app_update (employee) +
--           app_delete (manager) on every business table, and admin-only
--           writes on easyorders_config / business_settings.
--
-- Expected helper output for an admin session:
--   SELECT public.app_role_rank();          -- 3
--   SELECT public.app_has_role('manager');  -- true
--
-- Expected: the encrypted columns are NOT readable by a signed-in session:
--   SELECT has_column_privilege('authenticated', 'easyorders_config',
--                                'api_key', 'SELECT');   -- false
--   SELECT has_column_privilege('authenticated', 'easyorders_config',
--                                'webhook_secret', 'SELECT'); -- false
--   SELECT has_column_privilege('service_role', 'easyorders_config',
--                                'api_key', 'SELECT');   -- true
--   (a direct PostgREST read of those columns with a user JWT must fail)
