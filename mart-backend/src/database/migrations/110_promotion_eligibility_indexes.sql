-- Support the per-customer eligibility checks used by promotional pushes.
CREATE INDEX IF NOT EXISTS idx_mart_orders_promotion_active_customer
  ON mart_orders (customer_id)
  WHERE customer_id IS NOT NULL
    AND status IN ('pending', 'confirmed', 'preparing', 'ready_to_pickup', 'picked_up', 'out_for_delivery');

CREATE INDEX IF NOT EXISTS idx_mart_orders_promotion_delivered_customer
  ON mart_orders (customer_id, delivered_at DESC)
  WHERE customer_id IS NOT NULL AND status = 'delivered' AND delivered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mart_orders_promotion_closure_customer
  ON mart_orders (customer_id, (COALESCE(updated_at, created_at)) DESC)
  WHERE customer_id IS NOT NULL
    AND status IN ('cancelled', 'failed_delivery', 'customer_cancelled', 'cancelled_by_customer', 'customer_requested_cancellation');