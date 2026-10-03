-- Existing deployments may have created mart_carts before order conversion
-- attribution was added to migration 055. CREATE TABLE IF NOT EXISTS cannot
-- evolve that prior table, so add the column explicitly.
ALTER TABLE mart_carts
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES mart_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_carts_order_id
  ON mart_carts(order_id)
  WHERE order_id IS NOT NULL;