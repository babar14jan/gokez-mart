-- Migration 090: device dimension on funnel sessions.
--
-- Lets the customer journey be sliced by OS / device class / browser / whether
-- the visitor is in the installed app -- all first-party, no third-party
-- script, and no fingerprint. These are coarse facts read from the user agent
-- and `display-mode`, written once when the session first appears (and by the
-- client that starts sending them). Nullable so rows written before the client
-- shipped stay valid.

ALTER TABLE mart_funnel_sessions
  ADD COLUMN IF NOT EXISTS platform TEXT
    CHECK (platform IN ('ios', 'android', 'desktop', 'other')),
  ADD COLUMN IF NOT EXISTS device_category TEXT
    CHECK (device_category IN ('mobile', 'tablet', 'desktop')),
  ADD COLUMN IF NOT EXISTS browser TEXT,
  ADD COLUMN IF NOT EXISTS is_pwa BOOLEAN;

-- Dashboard reads are "platform split over a window", so this is the index
-- that matters. Partial: rows with no device (legacy) are not worth indexing.
CREATE INDEX IF NOT EXISTS idx_funnel_sessions_platform_seen
  ON mart_funnel_sessions(platform, first_seen_at DESC)
  WHERE platform IS NOT NULL;
