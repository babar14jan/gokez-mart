-- Add local/Hindi name field to products (transliterated, e.g. "Aloo" for Potato)
ALTER TABLE mart_products
  ADD COLUMN IF NOT EXISTS local_name TEXT DEFAULT NULL;
