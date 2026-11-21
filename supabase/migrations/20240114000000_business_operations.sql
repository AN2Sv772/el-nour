-- ============================================================================
-- MIGRATION: Business operations — cost snapshots, daily reconciliation,
-- expenses, audit log. ADDITIVE ONLY — no existing column is altered or
-- dropped, no existing row is touched.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Historical unit-cost snapshot on order lines
--    (new orders capture products.cost_price at creation/import time;
--     editing a product's cost later never rewrites history)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Product cost change audit trail
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_cost_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_cost NUMERIC(12,2),
  new_cost NUMERIC(12,2) NOT NULL,
  changed_by UUID REFERENCES user_profiles(id),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_cost_history_product ON product_cost_history(product_id, changed_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Reconciliation status on orders (driven by the daily reconciliation,
--    NOT by manual per-order status edits)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciliation_status TEXT
  DEFAULT 'pending'
  CHECK (reconciliation_status IN ('pending','reconciled','returned'));
CREATE INDEX IF NOT EXISTS idx_orders_reconciliation_status ON orders(reconciliation_status)
  WHERE reconciliation_status <> 'pending';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Expenses (shipping / packaging / advertising / other operating costs)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(40) NOT NULL DEFAULT 'other'
    CHECK (category IN ('shipping','packaging','advertising','other')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES user_profiles(id),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Daily reconciliation (one row per business date — prevents double close)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reconciliations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_date DATE NOT NULL UNIQUE,
  orders_count INTEGER NOT NULL DEFAULT 0,
  provisional_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  provisional_cogs NUMERIC(14,2) NOT NULL DEFAULT 0,
  provisional_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  returned_orders_count INTEGER NOT NULL DEFAULT 0,
  -- estimate: returned_orders_count × avg order value (labeled تقديري in UI)
  returned_orders_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- exact: Σ (qty × unit cost snapshot) of products physically received
  returned_products_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  expenses_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  reconciled_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  reopened_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES user_profiles(id)
);

CREATE TABLE IF NOT EXISTS daily_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reconciliation_id UUID NOT NULL REFERENCES daily_reconciliations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_returned INTEGER NOT NULL CHECK (quantity_returned > 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  value NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reconciliation_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_rec ON daily_reconciliation_items(reconciliation_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Generic audit log (cost/price changes, inventory, reconciliation edits,
--    expense changes, settings changes)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id),
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Enable RLS on the new tables
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE product_cost_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can view; managers/admins can manage
DROP POLICY IF EXISTS "Authenticated can view cost history" ON product_cost_history;
CREATE POLICY "Authenticated can view cost history" ON product_cost_history
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage cost history" ON product_cost_history;
CREATE POLICY "Managers manage cost history" ON product_cost_history
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Authenticated can view expenses" ON expenses;
CREATE POLICY "Authenticated can view expenses" ON expenses
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage expenses" ON expenses;
CREATE POLICY "Managers manage expenses" ON expenses
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Authenticated can view reconciliations" ON daily_reconciliations;
CREATE POLICY "Authenticated can view reconciliations" ON daily_reconciliations
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage reconciliations" ON daily_reconciliations;
CREATE POLICY "Managers manage reconciliations" ON daily_reconciliations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Authenticated can view reconciliation items" ON daily_reconciliation_items;
CREATE POLICY "Authenticated can view reconciliation items" ON daily_reconciliation_items
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage reconciliation items" ON daily_reconciliation_items;
CREATE POLICY "Managers manage reconciliation items" ON daily_reconciliation_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Managers view audit log" ON audit_log;
CREATE POLICY "Managers view audit log" ON audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));
DROP POLICY IF EXISTS "System inserts audit log" ON audit_log;
CREATE POLICY "System inserts audit log" ON audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Grants for the backend service role (server-only; RLS still protects
--    the authenticated role in the browser)
-- ────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_cost_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reconciliations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reconciliation_items TO service_role;
GRANT SELECT, INSERT ON public.audit_log TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
