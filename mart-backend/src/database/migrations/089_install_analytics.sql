-- Migration 089: Install analytics (separate from the marketing funnel).
--
-- Tracks PWA install behaviour: platform, prompt shows, acceptances, declines
-- and confirmed installs. Completely separate from mart_funnel_events so the
-- marketing funnel stays focused.

CREATE TABLE IF NOT EXISTS mart_install_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  visitor_id  TEXT,
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  event_name  TEXT NOT NULL CHECK (event_name IN (
    'install_prompt_shown',
    'install_prompt_accepted',
    'install_prompt_declined',
    'install_guide_opened',
    'install_guide_dismissed',
    'app_installed'
  )),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_install_events_platform
  ON mart_install_events(platform, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_install_events_event
  ON mart_install_events(event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_install_events_session
  ON mart_install_events(session_id, created_at DESC);

-- Rollup: one row per visitor per platform so "unique visitors who saw the
-- prompt" is a simple count, not a scan of the raw event table.
CREATE TABLE IF NOT EXISTS mart_install_rollup (
  visitor_id    TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prompt_shown    INT NOT NULL DEFAULT 0,
  prompt_accepted INT NOT NULL DEFAULT 0,
  prompt_declined INT NOT NULL DEFAULT 0,
  guide_opened    INT NOT NULL DEFAULT 0,
  guide_dismissed INT NOT NULL DEFAULT 0,
  app_installed   INT NOT NULL DEFAULT 0
);
