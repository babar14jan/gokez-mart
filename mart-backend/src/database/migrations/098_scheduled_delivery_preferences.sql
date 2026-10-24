-- Migration 098: a customer may choose a future delivery preference while the
-- store is open. The application validates that preference against the store's
-- IST opening hours; this constraint only maintains closure metadata.

ALTER TABLE mart_orders
  DROP CONSTRAINT IF EXISTS mart_orders_closure_consistency;

ALTER TABLE mart_orders
  ADD CONSTRAINT mart_orders_closure_consistency
  CHECK (
    (placed_outside_hours = false AND closed_reason IS NULL)
    OR (placed_outside_hours = true AND closed_reason IS NOT NULL)
  );