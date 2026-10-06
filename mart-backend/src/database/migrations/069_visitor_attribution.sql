-- A visitor can have many sessions. Preserve their original acquisition touch
-- separately from the most recent touch without storing customer PII.
CREATE TABLE IF NOT EXISTS mart_visitor_attribution (
  visitor_id TEXT PRIMARY KEY,
  first_source TEXT,
  first_medium TEXT,
  first_campaign TEXT,
  first_qr_code_id TEXT,
  last_source TEXT,
  last_medium TEXT,
  last_campaign TEXT,
  last_qr_code_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitor_attribution_first_touch
  ON mart_visitor_attribution(first_source, first_medium, first_seen_at DESC);