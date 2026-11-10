-- Migration 130: stock reservations for online orders.
ALTER TABLE mart_store_products
  ADD COLUMN IF NOT EXISTS reserved_stock NUMERIC(12,3) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mart_stock_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES mart_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released', 'shortage')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON mart_stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_store_product ON mart_stock_reservations(store_id, product_id, status);
