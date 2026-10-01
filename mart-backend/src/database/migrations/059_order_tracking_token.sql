ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS tracking_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tracking_token ON mart_orders(tracking_token) WHERE tracking_token IS NOT NULL;
