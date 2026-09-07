-- Migration 008: Add availability_status to mart_products
-- Replaces boolean is_available with 3-state: available | out_of_stock | hidden

ALTER TABLE mart_products
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available'
  CHECK (availability_status IN ('available', 'out_of_stock', 'hidden'));

-- Sync existing data: unavailable products → out_of_stock
UPDATE mart_products SET availability_status = 'out_of_stock' WHERE is_available = false;
