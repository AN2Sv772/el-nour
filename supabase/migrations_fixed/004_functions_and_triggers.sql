-- ============================================================================
-- MIGRATION 004: Functions and Triggers
-- Description: Core functions, triggers, and automation logic
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql
-- ============================================================================

-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_order_items_updated_at BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_whatsapp_conversations_updated_at BEFORE UPDATE ON whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_whatsapp_messages_updated_at BEFORE UPDATE ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_auto_reply_templates_updated_at BEFORE UPDATE ON auto_reply_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_business_settings_updated_at BEFORE UPDATE ON business_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_whatsapp_config_updated_at BEFORE UPDATE ON whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ai_config_updated_at BEFORE UPDATE ON ai_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_config_updated_at BEFORE UPDATE ON easyorders_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_sync_jobs_updated_at BEFORE UPDATE ON easyorders_sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_sync_job_details_updated_at BEFORE UPDATE ON easyorders_sync_job_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_webhook_events_updated_at BEFORE UPDATE ON easyorders_webhook_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_sync_jobs_updated_at BEFORE UPDATE ON easyorders_sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_webhook_events_updated_at BEFORE UPDATE ON easyorders_webhook_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_easyorders_sync_job_details_updated_at BEFORE UPDATE ON easyorders_sync_job_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- CUSTOMER STATS UPDATE TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE customers SET
      total_orders = total_orders + 1,
      total_spent = total_spent + NEW.total_amount,
      last_interaction_at = NOW()
    WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.total_amount != NEW.total_amount THEN
    UPDATE customers SET
      total_spent = total_spent - OLD.total_amount + NEW.total_amount,
      last_interaction_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_customer_stats_trigger
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_customer_stats();

-- ============================================================================
-- ORDER STATUS CHANGE HANDLER
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_by UUID;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Get the user who made the change from the session
    BEGIN
      v_changed_by := current_setting('request.jwt.claims', true)::json->>'sub';
    EXCEPTION WHEN OTHERS THEN
      v_changed_by := NULL;
    END;
    
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, metadata)
    VALUES (NEW.id, OLD.status, NEW.status, v_changed_by, jsonb_build_object('updated_at', NOW()));
    
    -- Update timestamps based on status
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at = NOW();
    ELSIF NEW.status = 'shipped' AND NEW.shipped_at IS NULL THEN
      NEW.shipped_at = NOW();
    ELSIF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN
      NEW.delivered_at = NOW();
    ELSIF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS handle_order_status_change_trigger ON orders;
CREATE TRIGGER handle_order_status_change_trigger
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION handle_order_status_change();

-- ============================================================================
-- INVENTORY RESERVATION ON ORDER CONFIRMATION
-- ============================================================================
CREATE OR REPLACE FUNCTION reserve_inventory_on_confirm()
RETURNS TRIGGER AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_product_record RECORD;
BEGIN
  -- Reserve inventory on confirmation
  IF OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
      v_quantity := (v_item->>'quantity')::INTEGER;
      
      -- Lock the product row to prevent concurrent overselling
      SELECT track_inventory, stock_quantity, name
      INTO v_product_record
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', v_product_id;
      END IF;

      IF v_product_record.track_inventory AND v_product_record.stock_quantity < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %', 
          v_product_record.name, v_product_record.stock_quantity, v_quantity;
      END IF;

      -- Reserve inventory
      INSERT INTO inventory_movements (product_id, variant_id, type, quantity, reference_id, reference_type, notes)
      VALUES (v_product_id, v_variant_id, 'reserved', v_quantity, NEW.id, 'order', 'Inventory reserved for order ' || NEW.order_number);
      
      -- Update product stock
      UPDATE products SET stock_quantity = stock_quantity - v_quantity WHERE id = v_product_id;
    END LOOP;
  END IF;
  
  -- Release inventory on cancellation
  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'returned') THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
      v_quantity := (v_item->>'quantity')::INTEGER;
      
      -- Release inventory
      INSERT INTO inventory_movements (product_id, variant_id, type, quantity, reference_id, reference_type, notes)
      VALUES (v_product_id, v_variant_id, 'released', v_quantity, OLD.id, 'order', 'Inventory released for order ' || OLD.order_number);
      
      -- Update product stock
      UPDATE products SET stock_quantity = stock_quantity + v_quantity WHERE id = v_product_id;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS reserve_inventory_on_confirm_trigger ON orders;
CREATE TRIGGER reserve_inventory_on_confirm_trigger
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION reserve_inventory_on_confirm();

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON WHATSAPP MESSAGE
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_last_interaction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE customers 
    SET last_interaction_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
CREATE TRIGGER update_customer_last_interaction_trigger
  AFTER INSERT ON whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_interaction();

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON ORDER CREATION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_last_interaction_on_order()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE customers 
  SET last_interaction_at = NOW()
  WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_customer_last_interaction_on_order_trigger ON orders;
CREATE TRIGGER update_customer_last_interaction_on_order_trigger
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_interaction_on_order();

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON WHATSAPP MESSAGE
-- ============================================================================
-- (Already defined above as update_customer_last_interaction trigger)

-- ============================================================================
-- ORDER STATUS HISTORY TRIGGER (handled by handle_order_status_change)
-- Already defined above

-- ============================================================================
-- INVENTORY RESERVATION ON ORDER CONFIRMATION
-- Already defined as reserve_inventory_on_confirm trigger

-- ============================================================================
-- CUSTOMER LAST INTERACTION UPDATE ON WHATSAPP MESSAGE
-- Already defined above


-- ============================================================================
-- ATOMIC ORDER CREATION WITH INVENTORY RESERVATION
-- ============================================================================
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_order_atomic TO authenticated;



-- ============================================================================
-- AUTH USER CREATED TRIGGER - Creates user_profiles on signup
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'employee',  -- Default role, not admin
    TRUE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

