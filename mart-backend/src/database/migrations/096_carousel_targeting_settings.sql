-- Migration 096: configurable carousel targeting and behavior.

ALTER TABLE mart_carousel_slides
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'guests', 'signed_in', 'new_customers', 'returning_customers')),
  ADD COLUMN IF NOT EXISTS hide_after_campaign_use BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS mart_carousel_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  autoplay_enabled BOOLEAN NOT NULL DEFAULT true,
  autoplay_interval_seconds INTEGER NOT NULL DEFAULT 4
    CHECK (autoplay_interval_seconds BETWEEN 3 AND 30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO mart_carousel_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM mart_carousel_settings);