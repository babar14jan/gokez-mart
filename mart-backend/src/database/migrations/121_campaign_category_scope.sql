CREATE TABLE IF NOT EXISTS mart_campaign_categories (
  campaign_id UUID NOT NULL REFERENCES mart_campaigns(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES mart_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_mart_campaign_categories_category
  ON mart_campaign_categories(category_id);
