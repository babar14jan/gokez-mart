-- Payment is collected and recorded by the delivery handler, not chosen at checkout.
ALTER TABLE mart_orders
  ALTER COLUMN payment_method DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_collected_at TIMESTAMPTZ;
