-- Migration 030: Add ready_to_pickup status
-- Store staff marks order as packed and ready for delivery boy to collect

ALTER TABLE mart_orders DROP CONSTRAINT IF EXISTS mart_orders_status_check;
ALTER TABLE mart_orders ADD CONSTRAINT mart_orders_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'preparing', 'ready_to_pickup',
    'out_for_delivery', 'picked_up', 'delivered',
    'cancelled', 'failed_delivery', 'terminated'
  ));
