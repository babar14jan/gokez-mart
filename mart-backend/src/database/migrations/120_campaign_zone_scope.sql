-- Migration 120: Explicit campaign-to-zone scope.
--
-- A campaign without rows here remains available in every zone. Rows restrict
-- redemption and public offer discovery to the selected delivery zones.

CREATE TABLE IF NOT EXISTS mart_campaign_zones (
  campaign_id UUID NOT NULL REFERENCES mart_campaigns(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES mart_zones(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_mart_campaign_zones_zone
  ON mart_campaign_zones(zone_id);
