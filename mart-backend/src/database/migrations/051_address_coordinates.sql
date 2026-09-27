ALTER TABLE mart_customer_addresses
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(9,6);