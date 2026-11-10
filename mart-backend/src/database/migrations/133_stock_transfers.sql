-- Migration 133: store-to-store inventory transfers.
CREATE TABLE IF NOT EXISTS mart_stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  destination_store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('requested', 'in_transit', 'received', 'partial', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  received_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_store_id <> destination_store_id)
);

CREATE TABLE IF NOT EXISTS mart_stock_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES mart_stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  in_transit_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),
  received_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'partial')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_source ON mart_stock_transfers(source_store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination ON mart_stock_transfers(destination_store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer ON mart_stock_transfer_lines(transfer_id);
