-- `updated_at` can change after delivery, so customer lifecycle reporting needs
-- an immutable delivery timestamp. Backfill conservatively from the first
-- recorded delivered transition, then fall back to legacy delivered rows.
ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

UPDATE mart_orders o
SET delivered_at = delivered.first_delivered_at
FROM (
  SELECT order_id, MIN(created_at) AS first_delivered_at
  FROM mart_order_status_events
  WHERE to_status = 'delivered'
  GROUP BY order_id
) delivered
WHERE o.id = delivered.order_id
  AND o.delivered_at IS NULL;

UPDATE mart_orders
SET delivered_at = updated_at
WHERE status = 'delivered'
  AND delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_customer
  ON mart_orders(delivered_at DESC, customer_id)
  WHERE status = 'delivered' AND customer_id IS NOT NULL;