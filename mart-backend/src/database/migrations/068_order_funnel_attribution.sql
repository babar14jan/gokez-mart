-- An order is the authoritative conversion record. Retain the anonymous
-- journey that created it directly on the order so attribution does not rely
-- on a cart row surviving or on a customer being verified.
ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS funnel_session_id TEXT,
  ADD COLUMN IF NOT EXISTS funnel_visitor_id TEXT,
  ADD COLUMN IF NOT EXISTS attribution_source TEXT,
  ADD COLUMN IF NOT EXISTS attribution_medium TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution_qr_code_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_funnel_session
  ON mart_orders(funnel_session_id)
  WHERE funnel_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_attribution
  ON mart_orders(attribution_source, attribution_medium, created_at DESC);