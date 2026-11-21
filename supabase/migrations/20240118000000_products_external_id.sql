-- Match imported products by stable external EasyOrders product id
ALTER TABLE products ADD COLUMN IF NOT EXISTS easyorders_product_id TEXT;
CREATE INDEX IF NOT EXISTS idx_products_easyorders_id ON products(easyorders_product_id)
  WHERE easyorders_product_id IS NOT NULL;
