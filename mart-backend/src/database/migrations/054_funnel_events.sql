-- Phase 2 customer funnel instrumentation (first-party, no third-party tracker).
--
-- Design notes:
--   * Anonymous by default. `mart_funnel_events` deliberately has no phone, no
--     email and no customer id column, so a leak of this table can never expose
--     personal data. The link to a known customer lives on the session row and
--     is written server-side at OTP verification, when the backend already
--     holds the phone number.
--   * `mart_customer_leads` remains the single home for lead PII (phone, name).
--   * Append-only: events are never updated, only inserted. Corrections are new
--     rows, which keeps the audit trail honest for marketing reporting.

CREATE TABLE IF NOT EXISTS mart_funnel_sessions (
  session_id        TEXT PRIMARY KEY,
  channel           TEXT NOT NULL DEFAULT 'unattributed',
  landing_path      TEXT,
  referrer          TEXT,
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  customer_id       UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  -- First and last campaign seen in this session. These two columns are what
  -- make dual first-touch / last-touch attribution possible without storing
  -- a separate touch table.
  first_campaign_id UUID REFERENCES mart_campaigns(id) ON DELETE SET NULL,
  last_campaign_id  UUID REFERENCES mart_campaigns(id) ON DELETE SET NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mart_funnel_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  event_name  TEXT NOT NULL,
  path        TEXT,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard reads are always "one event name over a time window", so this is
-- the index that matters. The session index serves single-session timelines.
CREATE INDEX IF NOT EXISTS idx_funnel_events_name_created
  ON mart_funnel_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_events_session
  ON mart_funnel_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_sessions_channel_seen
  ON mart_funnel_sessions(channel, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_sessions_customer_seen
  ON mart_funnel_sessions(customer_id, first_seen_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funnel_sessions_first_campaign
  ON mart_funnel_sessions(first_campaign_id)
  WHERE first_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funnel_sessions_last_campaign
  ON mart_funnel_sessions(last_campaign_id)
  WHERE last_campaign_id IS NOT NULL;

-- Retention. Raw events are a high-volume, low-value table once the funnel is
-- aggregated, so they are pruned first. Sessions survive longer because
-- attribution and the "verified but never ordered" join depend on them.
CREATE OR REPLACE FUNCTION purge_funnel_events_older_than(days INTEGER)
RETURNS INTEGER AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM mart_funnel_events
  WHERE created_at < NOW() - (days * INTERVAL '1 day');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;
