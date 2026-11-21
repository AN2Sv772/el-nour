-- ============================================================================
-- MIGRATION: Atomic daily reconciliation close (single transaction)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.close_daily_reconciliation(
  p_business_date DATE,
  p_orders_count INTEGER,
  p_provisional_sales NUMERIC,
  p_provisional_cogs NUMERIC,
  p_provisional_profit NUMERIC,
  p_returned_orders_count INTEGER,
  p_returned_orders_value NUMERIC,
  p_returned_products_value NUMERIC,
  p_shipping_expenses NUMERIC,
  p_expenses_total NUMERIC,
  p_reconciled_profit NUMERIC,
  p_notes TEXT,
  p_user_id UUID,
  p_return_items JSONB -- [{product_id, quantity_returned, unit_cost}]
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_rec_id UUID;
  v_item JSONB;
  v_current_stock INTEGER;
BEGIN
  -- Double-close guard
  SELECT id INTO v_rec_id FROM daily_reconciliations WHERE business_date = p_business_date;
  IF v_rec_id IS NOT NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_EXISTS';
  END IF;

  INSERT INTO daily_reconciliations (
    business_date, orders_count, provisional_sales, provisional_cogs,
    provisional_profit, returned_orders_count, returned_orders_value,
    returned_products_value, shipping_expenses, expenses_total,
    reconciled_profit, notes, created_by
  ) VALUES (
    p_business_date, p_orders_count, p_provisional_sales, p_provisional_cogs,
    p_provisional_profit, p_returned_orders_count, p_returned_orders_value,
    p_returned_products_value, p_shipping_expenses, p_expenses_total,
    p_reconciled_profit, p_notes, p_user_id
  ) RETURNING id INTO v_rec_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_return_items, '[]'::jsonb))
  LOOP
    INSERT INTO daily_reconciliation_items (
      reconciliation_id, product_id, quantity_returned, unit_cost, value
    ) VALUES (
      v_rec_id,
      (v_item->>'product_id')::UUID,
      (v_item->>'quantity_returned')::INTEGER,
      (v_item->>'unit_cost')::NUMERIC,
      ROUND((v_item->>'quantity_returned')::INTEGER * (v_item->>'unit_cost')::NUMERIC, 2)
    );

    INSERT INTO inventory_movements (product_id, type, quantity, notes, created_by)
    VALUES (
      (v_item->>'product_id')::UUID,
      'in',
      (v_item->>'quantity_returned')::INTEGER,
      'استرجاع مخزون — تسوية يوم ' || p_business_date::TEXT,
      p_user_id
    );

    SELECT stock_quantity INTO v_current_stock FROM products WHERE id = (v_item->>'product_id')::UUID FOR UPDATE;
    UPDATE products SET stock_quantity = v_current_stock + (v_item->>'quantity_returned')::INTEGER
    WHERE id = (v_item->>'product_id')::UUID;
  END LOOP;

  RETURN v_rec_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_daily_reconciliation(DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) TO service_role;
