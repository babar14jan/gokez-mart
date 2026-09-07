-- Migration 023: Drop legacy columns from mart_products
-- These columns were moved to mart_store_products in migration 010
-- On a fresh DB they still exist with NOT NULL constraints, breaking product creation

ALTER TABLE mart_products DROP COLUMN IF EXISTS price;
ALTER TABLE mart_products DROP COLUMN IF EXISTS unit;
ALTER TABLE mart_products DROP COLUMN IF EXISTS discount_percent;
ALTER TABLE mart_products DROP COLUMN IF EXISTS is_available;
ALTER TABLE mart_products DROP COLUMN IF EXISTS sort_order;
