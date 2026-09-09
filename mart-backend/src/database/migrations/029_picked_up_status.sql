-- Migration 029: Add picked_up status
-- Delivery boy confirms handover from store before going to customer

ALTER TABLE mart_orders DROP CONSTRAINT IF EXISTS mart_orders_status_check;
ALTER TABLE mart_orders ADD CONSTRAINT mart_orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery', 'picked_up', 'delivered', 'cancelled', 'failed_delivery', 'terminated'));
