ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS first_touch_source TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_medium TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_campaign TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_qr_code_id TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_source TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_medium TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_campaign TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_qr_code_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_first_touch
  ON mart_orders(first_touch_source, first_touch_medium, created_at DESC);