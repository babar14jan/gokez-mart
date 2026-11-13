-- Weight options used to live on the global product, but their prices are
-- store-specific. Keep each store's options with its own listing so editing a
-- product in one store cannot change what another store sells or charges.
ALTER TABLE mart_store_products
  ADD COLUMN IF NOT EXISTS weight_options JSONB;

UPDATE mart_store_products sp
   SET weight_options = p.weight_options
  FROM mart_products p
 WHERE p.id = sp.product_id
   AND sp.weight_options IS NULL
   AND p.weight_options IS NOT NULL;
