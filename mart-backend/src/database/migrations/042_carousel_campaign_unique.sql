-- Migration 042: Unique constraint on carousel_slides campaign_id
ALTER TABLE mart_carousel_slides ADD CONSTRAINT uq_carousel_campaign_id UNIQUE (campaign_id);
