-- Migration 103: Multi-photo catalog products
--
-- A catalog product now carries a photo gallery (up to four URLs) with a single
-- primary. The legacy single photo_url column stays as the primary fallback for
-- rows created before this migration, so reads and writes can be backward
-- compatible while new writes populate both columns.

ALTER TABLE mart_products ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE mart_products
SET photos = CASE
  WHEN photo_url IS NOT NULL THEN jsonb_build_array(photo_url)
  ELSE '[]'::jsonb
END
WHERE photo_url IS NOT NULL AND photos = '[]'::jsonb;
