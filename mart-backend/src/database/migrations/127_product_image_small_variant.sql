-- Migration 127: add a small product image variant and local original path.
ALTER TABLE mart_product_image_assets
  ADD COLUMN IF NOT EXISTS small_url TEXT,
  ADD COLUMN IF NOT EXISTS small_key TEXT,
  ADD COLUMN IF NOT EXISTS original_local_path TEXT;

UPDATE mart_product_image_assets
SET small_url = COALESCE(small_url, thumbnail_url),
    small_key = COALESCE(small_key, thumbnail_key)
WHERE small_url IS NULL OR small_key IS NULL;
