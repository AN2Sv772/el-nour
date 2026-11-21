-- Migration to fix WhatsApp message status consistency and add proper constraints

-- Fix whatsapp_messages status default to 'received' for inbound messages
ALTER TABLE whatsapp_messages ALTER COLUMN status SET DEFAULT 'received';

-- Add unique constraint on whatsapp_message_id for inbound messages (prevent duplicates)
-- We need a partial unique index since outbound messages also use this field
DROP INDEX IF EXISTS idx_whatsapp_messages_whatsapp_id;
CREATE UNIQUE INDEX idx_whatsapp_messages_whatsapp_id_inbound 
  ON whatsapp_messages (whatsapp_message_id) 
  WHERE direction = 'inbound';

-- Add index for outbound messages
CREATE INDEX idx_whatsapp_messages_whatsapp_id_outbound 
  ON whatsapp_messages (whatsapp_message_id) 
  WHERE direction = 'outbound';

-- Add unique constraint on order_number for better data integrity
-- (already exists in initial migration)

-- Add foreign key for order_items.variant_id to products
-- Note: variants are stored as JSONB in products, so we can't easily add FK
-- Instead, we'll add a check constraint
ALTER TABLE order_items 
  ADD CONSTRAINT check_variant_id_format 
  CHECK (variant_id IS NULL OR variant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Add index for automation_logs by reference
CREATE INDEX IF NOT EXISTS idx_automation_logs_reference_type_id 
  ON automation_logs (reference_type, reference_id);

-- Add trigger to update customer last_interaction_at on new message
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_customer_last_interaction_trigger ON whatsapp_messages;
CREATE TRIGGER update_customer_last_interaction_trigger
  AFTER INSERT ON whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_interaction();

-- Fix the handle_order_status_change function to properly get the user ID
CREATE OR REPLACE FUNCTION handle_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_by UUID;
BEGIN
  IF OLD.status != NEW.status THEN
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
$$ LANGUAGE plpgsql;

-- Fix the reserve_inventory_on_confirm function to handle edge cases
CREATE OR REPLACE FUNCTION reserve_inventory_on_confirm()
RETURNS TRIGGER AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
BEGIN
  IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := CASE WHEN v_item->>'variant_id' IS NOT NULL THEN (v_item->>'variant_id')::UUID ELSE NULL END;
      v_quantity := (v_item->>'quantity')::INTEGER;
      
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
$$ LANGUAGE plpgsql;