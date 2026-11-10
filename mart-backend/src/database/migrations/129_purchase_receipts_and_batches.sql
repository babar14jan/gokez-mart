-- Migration 129: purchase receipts and FIFO cost batches.
CREATE TABLE IF NOT EXISTS mart_purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  supplier_name TEXT,
  invoice_number TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mart_purchase_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES mart_purchase_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  batch_id UUID,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_cost NUMERIC(12,4) NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0)
);

CREATE TABLE IF NOT EXISTS mart_purchase_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  receipt_line_id UUID REFERENCES mart_purchase_receipt_lines(id) ON DELETE SET NULL,
  quantity_received NUMERIC(12,3) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining NUMERIC(12,3) NOT NULL CHECK (quantity_remaining >= 0),
  unit TEXT NOT NULL,
  unit_cost NUMERIC(12,4) NOT NULL CHECK (unit_cost >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'voided')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_batches_store_product
  ON mart_purchase_batches(store_id, product_id, received_at, id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_store
  ON mart_purchase_receipts(store_id, received_at DESC);
