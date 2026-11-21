-- ============================================================================
-- MIGRATION: Shipping collection reconciliation + expense categories
-- ADDITIVE ONLY — no existing data touched.
--
-- Financial separation (approved):
--   customer-paid shipping   = orders.shipping_fee (collected by company)
--   business shipping expense = settings default, snapshotted on orders
--   company deductions        = collection_deductions (separate line items)
--   cash actually received    = collection_batches.received_amount
--   outstanding               = expected − received (per batch / totals)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Expense categories (user-editable)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(60) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO expense_categories (name) VALUES
  ('شحن'), ('تغليف'), ('إعلانات'), ('رواتب'), ('إيجار'),
  ('خدمات'), ('تشغيل'), ('صيانة'), ('أخرى')
ON CONFLICT (name) DO NOTHING;

-- Loosen the fixed category CHECK on expenses (keep existing values valid)
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Shipping collection batches — each actual payment/transfer received
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collection_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(120) NOT NULL,
  batch_reference VARCHAR(120),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  orders_date_from DATE,
  orders_date_to DATE,
  expected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','matched','closed')),
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_collection_batches_date ON collection_batches(transfer_date DESC);

-- Deduction line items (company charges/fees/adjustments — SEPARATE from the
-- business's own shipping expense)
CREATE TABLE IF NOT EXISTS collection_deductions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES collection_batches(id) ON DELETE CASCADE,
  label VARCHAR(160) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order allocations: one order settles exactly once (prevents double counting)
CREATE TABLE IF NOT EXISTS collection_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES collection_batches(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_allocations_batch ON collection_allocations(batch_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view expense categories" ON expense_categories;
CREATE POLICY "Authenticated can view expense categories" ON expense_categories
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage expense categories" ON expense_categories;
CREATE POLICY "Managers manage expense categories" ON expense_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Authenticated can view collection batches" ON collection_batches;
CREATE POLICY "Authenticated can view collection batches" ON collection_batches
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage collection batches" ON collection_batches;
CREATE POLICY "Managers manage collection batches" ON collection_batches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Authenticated can view deductions" ON collection_deductions;
CREATE POLICY "Authenticated can view deductions" ON collection_deductions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage deductions" ON collection_deductions;
CREATE POLICY "Managers manage deductions" ON collection_deductions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

DROP POLICY IF EXISTS "Authenticated can view allocations" ON collection_allocations;
CREATE POLICY "Authenticated can view allocations" ON collection_allocations
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Managers manage allocations" ON collection_allocations;
CREATE POLICY "Managers manage allocations" ON collection_allocations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','manager')));

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Service-role grants (backend server-only role)
-- ────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_deductions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_allocations TO service_role;
