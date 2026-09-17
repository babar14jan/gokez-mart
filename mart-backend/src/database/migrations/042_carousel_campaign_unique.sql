-- Migration 042: Unique constraint on carousel_slides campaign_id (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_carousel_campaign_id'
  ) THEN
    ALTER TABLE mart_carousel_slides ADD CONSTRAINT uq_carousel_campaign_id UNIQUE (campaign_id);
  END IF;
END $$;
