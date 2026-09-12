-- Add stock tracking columns to mart_store_products (per-store stock)
ALTER TABLE mart_store_products
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT NULL;

-- Inventory log table
CREATE TABLE IF NOT EXISTS mart_inventory_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  store_id        UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  change_qty      INTEGER NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('restock', 'order_deducted', 'manual_correction')),
  reference_id    UUID DEFAULT NULL,
  note            TEXT DEFAULT NULL,
  created_by      UUID DEFAULT NULL REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON mart_inventory_log(product_id, store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_log_store   ON mart_inventory_log(store_id, created_at DESC);
