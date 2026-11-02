-- Combos are store-owned listings, never reusable master catalog products.
-- Repair databases that ran the catalog-source backfill before bundle rows
-- were excluded from it.
UPDATE mart_products
   SET is_catalog = false
 WHERE is_bundle = true
   AND is_catalog = true;