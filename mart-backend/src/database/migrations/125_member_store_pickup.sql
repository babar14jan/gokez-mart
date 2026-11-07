-- Migration 125: Member-store pickup tracking
ALTER TABLE mart_order_store_fulfilments
  DROP CONSTRAINT IF EXISTS mart_order_store_fulfilments_status_check;

ALTER TABLE mart_order_store_fulfilments
  ADD CONSTRAINT mart_order_store_fulfilments_status_check
  CHECK (status IN ('pending', 'prepared', 'delivered', 'picked_up', 'cancelled'));

ALTER TABLE mart_order_store_fulfilments
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picked_up_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mart_order_store_fulfilments_picked_up
  ON mart_order_store_fulfilments(order_id, picked_up_at);

UPDATE mart_order_store_fulfilments f
   SET status = 'picked_up',
       delivered_at = COALESCE(f.delivered_at, o.delivered_at, NOW()),
       picked_up_at = COALESCE(f.picked_up_at, o.delivered_at, NOW()),
       updated_at = NOW()
  FROM mart_orders o
 WHERE f.order_id = o.id
   AND o.status = 'delivered'
   AND f.status IN ('pending', 'prepared', 'delivered');
