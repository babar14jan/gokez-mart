-- Canonical analytics identity and attribution. Historical rows stay nullable:
-- these values cannot be reconstructed reliably and must not be guessed.
ALTER TABLE mart_funnel_sessions
  ADD COLUMN IF NOT EXISTS visitor_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS medium TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS term TEXT,
  ADD COLUMN IF NOT EXISTS qr_code_id TEXT;

CREATE INDEX IF NOT EXISTS idx_funnel_sessions_visitor_seen
  ON mart_funnel_sessions(visitor_id, first_seen_at DESC)
  WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funnel_sessions_source_seen
  ON mart_funnel_sessions(source, medium, first_seen_at DESC);

-- Orders can be joined to their originating anonymous session through
-- mart_carts.order_id for new tracked checkouts. These indexes make the
-- aggregation and reconciliation queries inexpensive.
CREATE INDEX IF NOT EXISTS idx_carts_session_order
  ON mart_carts(session_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_created_status
  ON mart_orders(created_at DESC, status);