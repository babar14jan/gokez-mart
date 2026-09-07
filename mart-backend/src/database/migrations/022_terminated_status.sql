-- Migration 022: Add terminated status for admin force-close of stale orders
ALTER TABLE mart_orders DROP CONSTRAINT IF EXISTS mart_orders_status_check;
ALTER TABLE mart_orders ADD CONSTRAINT mart_orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'failed_delivery', 'terminated'));

ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS termination_reason TEXT;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS terminated_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;
