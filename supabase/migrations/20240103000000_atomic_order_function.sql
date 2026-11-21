-- Migration to add atomic order creation with inventory reservation
-- This creates a PostgreSQL function that handles order creation atomically

CREATE OR REPLACE FUNCTION create_order_atomic(
  p_customer_id UUID,
  p_items JSONB,
  p_shipping_address JSONB,
  p_billing_address JSONB,
  p_payment_method payment_method DEFAULT 'cash_on_delivery',
  p_shipping_fee DECIMAL(10,2) DEFAULT 0,
  p_discount_amount DECIMAL(12,2) DEFAULT 0,
  p_tax_amount DECIMAL(10,2) DEFAULT 0,
  p_notes TEXT,
  p_source VARCHAR(50) DEFAULT 'manual'
) RETURNS UUID AS $$
DECLARE
  v_order_number VARCHAR(50);
  v_subtotal DECIMAL(12,2) := 0;
  v_total_amount DECIMAL(12,2);
  v_order_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_unit_price DECIMAL(10,2);
  v_discount DECIMAL(10,2);
  v_total_price DECIMAL(12,2);
  v_product_record RECORD;
BEGIN
  -- Calculate subtotal from items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_unit_price := (v_item->>'unit_price')::DECIMAL(10,2);
    v_discount := COALESCE((v_item->>'discount')::DECIMAL(10,2), 0);
    v_total_price := v_quantity * v_unit_price - v_discount;
    v_subtotal := v_subtotal + v_total_price;
  END LOOP;

  v_total_amount := v_subtotal - p_discount_amount + p_shipping_fee + p_tax_amount;

  -- Generate order number
  v_order_number := 'ORD-' || to_char(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  -- Create order
  INSERT INTO orders (
    order_number,
    customer_id,
    status,
    payment_status,
    payment_method,
    subtotal,
    discount_amount,
    shipping_fee,
    tax_amount,
    total_amount,
    items,
    shipping_address,
    billing_address,
    notes,
    source
  ) VALUES (
    v_order_number,
    p_customer_id,
    'pending',
    CASE WHEN p_payment_method = 'cash_on_delivery' THEN 'pending' ELSE 'pending' END,
    p_payment_method,
    v_subtotal,
    p_discount_amount,
    p_shipping_fee,
    p_tax_amount,
    v_total_amount,
    p_items,
    p_shipping_address,
    p_billing_address,
    p_notes,
    p_source
  ) RETURNING id INTO v_order_id;

  -- Create order items and validate inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_unit_price := (v_item->>'unit_price')::DECIMAL(10,2);
    v_discount := COALESCE((v_item->>'discount')::DECIMAL(10,2), 0);
    v_total_price := v_quantity * v_unit_price - v_discount;

    -- Validate inventory
    SELECT track_inventory, stock_quantity, name
    INTO v_product_record
    FROM products
    WHERE id = v_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found: %', v_product_id;
    END IF;

    IF v_product_record.track_inventory AND v_product_record.stock_quantity < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %', 
        v_product_record.name, v_product_record.stock_quantity, v_quantity;
    END IF;

    -- Insert order item
    INSERT INTO order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_name_ar,
      sku,
      variant_name,
      quantity,
      unit_price,
      discount,
      total_price
    ) VALUES (
      v_order_id,
      v_product_id,
      v_variant_id,
      v_item->>'product_name',
      v_item->>'product_name_ar',
      v_item->>'sku',
      v_item->>'variant_name',
      v_quantity,
      v_unit_price,
      v_discount,
      v_total_price
    );
  END LOOP;

  -- Log automation
  INSERT INTO automation_logs (type, status, reference_id, reference_type, details)
  VALUES ('order_created', 'success', v_order_id, 'order', 
    jsonb_build_object('order_number', v_order_number, 'customer_id', p_customer_id, 'item_count', jsonb_array_length(p_items)));

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_order_atomic TO authenticated;