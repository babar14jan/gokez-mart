-- Persist the original delivery promise and customer-cancellation context.
ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS promised_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_window_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_customer_message TEXT;

CREATE INDEX IF NOT EXISTS idx_mart_orders_promised_delivery_at
  ON mart_orders (promised_delivery_at)
  WHERE status IN ('pending', 'confirmed');