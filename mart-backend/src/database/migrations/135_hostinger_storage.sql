-- Support Hostinger VPS image storage as an additional storage driver.
ALTER TABLE mart_product_image_assets
  ADD COLUMN IF NOT EXISTS storage_id TEXT;

ALTER TABLE mart_product_image_assets
  DROP CONSTRAINT IF EXISTS mart_product_image_assets_storage_driver_check;

ALTER TABLE mart_product_image_assets
  ADD CONSTRAINT mart_product_image_assets_storage_driver_check
  CHECK (storage_driver IN ('local', 'supabase', 'hostinger'));
