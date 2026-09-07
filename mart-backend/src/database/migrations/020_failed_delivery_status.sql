-- Migration 020: Add failed_delivery status for refused/failed deliveries
ALTER TABLE mart_orders DROP CONSTRAINT IF EXISTS mart_orders_status_check;
ALTER TABLE mart_orders ADD CONSTRAINT mart_orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'failed_delivery'));
