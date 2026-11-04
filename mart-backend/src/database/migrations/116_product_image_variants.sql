-- Product images now have pre-generated delivery variants. Legacy photo_url and
-- photos remain the compatibility fallback while clients roll forward.
ALTER TABLE mart_products
  ADD COLUMN IF NOT EXISTS photo_variants JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Existing objects are deliberately not copied or re-encoded in this migration.
-- Each legacy URL is exposed as every variant until the resumable backfill creates
-- real resized objects and replaces this metadata.
UPDATE mart_products
SET photo_variants = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'thumbnailUrl', photo,
        'mediumUrl', photo,
        'largeUrl', photo
      )
    )
    FROM jsonb_array_elements_text(photos) AS photo
  ),
  '[]'::jsonb
)
WHERE photo_variants = '[]'::jsonb
  AND jsonb_array_length(photos) > 0;