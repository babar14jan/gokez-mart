ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_request_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_request_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_request_decision TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_request_decided_by TEXT;

CREATE INDEX IF NOT EXISTS idx_mart_orders_cancellation_requests
  ON mart_orders (cancellation_requested_at DESC)
  WHERE cancellation_requested_at IS NOT NULL AND cancellation_request_decision IS NULL;