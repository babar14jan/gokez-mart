-- Migration 132: stock adjustment audit table.
CREATE TABLE IF NOT EXISTS mart_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('damage','spoiled','expired','lost','missing','consumption','quality_rejection','other')),
  notes TEXT,
  created_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_store ON mart_stock_adjustments(store_id, created_at DESC);
