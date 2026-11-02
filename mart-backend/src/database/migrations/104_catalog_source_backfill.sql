UPDATE mart_products
   SET is_catalog = true
 WHERE is_catalog = false
   AND is_bundle = false;
