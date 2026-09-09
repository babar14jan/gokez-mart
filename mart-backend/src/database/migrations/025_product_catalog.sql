-- Migration 025: Master Product Catalog
-- Super admin manages a global catalog of products with photos/descriptions
-- Store managers pick from catalog and set their own price

-- Add catalog_product_id to mart_products to track catalog origin
ALTER TABLE mart_products ADD COLUMN IF NOT EXISTS is_catalog BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mart_products ADD COLUMN IF NOT EXISTS catalog_id UUID REFERENCES mart_products(id) ON DELETE SET NULL;

-- Mark existing products as catalog items (they were added by super admin)
UPDATE mart_products SET is_catalog = true WHERE catalog_id IS NULL;

-- Index for catalog lookup
CREATE INDEX IF NOT EXISTS idx_mart_products_catalog ON mart_products(is_catalog);
