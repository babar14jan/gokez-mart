-- Migration 128: append-only inventory movement ledger and opening balances.
CREATE TABLE IF NOT EXISTS mart_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  location_id UUID,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening_stock', 'restock', 'sale', 'adjustment', 'transfer_in', 'transfer_out',
    'return_in', 'return_out', 'damage', 'reconciliation'
  )),
  quantity_in NUMERIC(12,3) NOT NULL DEFAULT 0,
  quantity_out NUMERIC(12,3) NOT NULL DEFAULT 0,
  previous_balance NUMERIC(12,3),
  new_balance NUMERIC(12,3),
  unit TEXT,
  unit_cost NUMERIC(12,4),
  total_cost NUMERIC(12,2),
  source_type TEXT,
  source_id UUID,
  batch_id UUID,
  created_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  remarks TEXT,
  idempotency_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_idempotency
  ON mart_inventory_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_product
  ON mart_inventory_movements(store_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_source
  ON mart_inventory_movements(source_type, source_id);

-- Backfill current balances as opening stock. Idempotent by movement type.
INSERT INTO mart_inventory_movements
  (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance,
   unit, reason, remarks, created_at)
SELECT sp.product_id, sp.store_id, 'opening_stock', sp.stock_quantity, 0, 0, sp.stock_quantity,
       sp.stock_unit, 'opening_stock', 'Backfilled from current stock balance', NOW()
FROM mart_store_products sp
WHERE sp.stock_quantity IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mart_inventory_movements m
    WHERE m.product_id = sp.product_id
      AND m.store_id = sp.store_id
      AND m.movement_type = 'opening_stock'
  );
