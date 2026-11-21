-- ============================================================================
-- MIGRATION 005: EasyOrders Sync Functions
-- Description: EasyOrders sync, sync jobs, webhook processing functions
-- Dependencies: 001_extensions_and_enums.sql, 002_core_tables.sql, 004_functions_and_triggers.sql
-- ============================================================================

-- ============================================================================
-- EASYORDERS SERVICE FUNCTIONS
-- ============================================================================

-- Function to clean up old webhook events (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_easyorders_webhook_events()
RETURNS void AS $$
BEGIN
  DELETE FROM easyorders_webhook_events 
  WHERE created_at < NOW() - INTERVAL '30 days'
  AND processed = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get or create EasyOrders config
CREATE OR REPLACE FUNCTION get_or_create_easyorders_config()
RETURNS TABLE (id UUID, api_key TEXT, is_connected BOOLEAN) AS $$
DECLARE
  v_config RECORD;
BEGIN
  SELECT * INTO v_config
  FROM easyorders_config
  LIMIT 1;
  
  IF FOUND THEN
    RETURN QUERY SELECT v_config.id, v_config.api_key, v_config.is_connected;
  ELSE
    INSERT INTO easyorders_config (api_key, is_connected)
    VALUES ('', FALSE)
    RETURNING id, api_key, is_connected;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- EASYORDERS SYNC SERVICE FUNCTIONS
-- ============================================================================

-- Status mapping from EasyOrders to local
CREATE OR REPLACE FUNCTION map_easyorders_status(p_status TEXT)
RETURNS TABLE (local_status order_status, is_mapped BOOLEAN) AS $$
DECLARE
  v_status TEXT := lower(p_status);
BEGIN
  CASE v_status
    WHEN 'pending' THEN RETURN QUERY SELECT 'pending'::order_status, TRUE;
    WHEN 'awaiting_confirmation' THEN RETURN QUERY SELECT 'awaiting_confirmation'::order_status, TRUE;
    WHEN 'confirmed' THEN RETURN QUERY SELECT 'confirmed'::order_status, TRUE;
    WHEN 'processing' THEN RETURN QUERY SELECT 'preparing'::order_status, TRUE;
    WHEN 'preparing' THEN RETURN QUERY SELECT 'preparing'::order_status, TRUE;
    WHEN 'ready_for_shipping' THEN RETURN QUERY SELECT 'ready_for_shipping'::order_status, TRUE;
    WHEN 'ready_to_ship' THEN RETURN QUERY SELECT 'ready_for_shipping'::order_status, TRUE;
    WHEN 'shipped' THEN RETURN QUERY SELECT 'shipped'::order_status, TRUE;
    WHEN 'out_for_delivery' THEN RETURN QUERY SELECT 'out_for_delivery'::order_status, TRUE;
    WHEN 'out_for_deliver' THEN RETURN QUERY SELECT 'out_for_delivery'::order_status, TRUE;
    WHEN 'delivered' THEN RETURN QUERY SELECT 'delivered'::order_status, TRUE;
    WHEN 'cancelled' THEN RETURN QUERY SELECT 'cancelled'::order_status, TRUE;
    WHEN 'returned' THEN RETURN QUERY SELECT 'returned'::order_status, TRUE;
    WHEN 'returned_partially' THEN RETURN QUERY SELECT 'returned'::order_status, TRUE;
    WHEN 'failed_delivery' THEN RETURN QUERY SELECT 'failed_delivery'::order_status, TRUE;
    WHEN 'return_requested' THEN RETURN QUERY SELECT 'pending'::order_status, FALSE;
    WHEN 'refunded' THEN RETURN QUERY SELECT 'returned'::order_status, TRUE;
    WHEN 'paid' THEN RETURN QUERY SELECT 'confirmed'::order_status, TRUE;
    ELSE RETURN QUERY SELECT 'pending'::order_status, FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Map payment method from EasyOrders to local
CREATE OR REPLACE FUNCTION map_payment_method(p_method TEXT)
RETURNS payment_method AS $$
DECLARE
  v_method TEXT := lower(p_method);
BEGIN
  CASE v_method
    WHEN 'cod' THEN RETURN 'cash_on_delivery';
    WHEN 'cash' THEN RETURN 'cash_on_delivery';
    WHEN 'card' THEN RETURN 'card';
    WHEN 'credit_card' THEN RETURN 'card';
    WHEN 'bank_transfer' THEN RETURN 'bank_transfer';
    WHEN 'wallet' THEN RETURN 'wallet';
    ELSE RETURN 'cash_on_delivery';
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Normalize phone number for WhatsApp
CREATE OR REPLACE FUNCTION normalize_phone_for_whatsapp(p_phone TEXT)
RETURNS TEXT AS $$
DECLARE
  v_cleaned TEXT := regexp_replace(p_phone, '\D', '', 'g');
BEGIN
  -- Handle Egyptian numbers
  IF v_cleaned LIKE '20%' THEN
    RETURN '+' || v_cleaned;
  ELSIF v_cleaned LIKE '0%' THEN
    RETURN '+2' || v_cleaned;
  ELSIF length(v_cleaned) = 10 AND v_cleaned LIKE '1%' THEN
    -- Egyptian mobile without country code
    RETURN '+20' || v_cleaned;
  END IF;
  RETURN '+' || v_cleaned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Verify webhook signature
CREATE OR REPLACE FUNCTION verify_easyorders_webhook_signature(
  p_payload TEXT, 
  p_signature TEXT, 
  p_secret TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_expected_signature TEXT;
BEGIN
  v_expected_signature := encode(
    hmac(p_secret, p_payload, 'sha256'),
    'hex'
  );
  
  -- EasyOrders sends signature in format: sha256=...
  IF p_signature LIKE 'sha256=%' THEN
    RETURN hmac(p_secret, p_payload, 'sha256') = decode(substring(p_signature from 8), 'hex');
  END IF;
  
  RETURN hmac(p_secret, p_payload, 'sha256') = decode(p_signature, 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Parse webhook payload
CREATE OR REPLACE FUNCTION parse_easyorders_webhook(payload JSONB)
RETURNS TABLE (event_type TEXT, data JSONB) AS $$
BEGIN
  IF payload IS NULL THEN
    RETURN QUERY SELECT 'unknown'::TEXT, '{}'::JSONB;
  END IF;
  
  -- Order created event - payload is the order object directly
  IF payload ? 'id' AND payload ? 'cart_items' THEN
    RETURN QUERY SELECT 'order-created'::TEXT, payload;
  END IF;
  
  -- Order status update event
  IF payload ? 'event_type' AND payload->>'event_type' = 'order-status-update' THEN
    RETURN QUERY SELECT 'order-status-update'::TEXT, payload;
  END IF;
  
  RETURN QUERY SELECT 'unknown'::TEXT, payload;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
