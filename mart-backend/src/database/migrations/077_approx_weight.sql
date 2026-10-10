-- Approximate weight range for produce sold per piece (e.g. "200-300 g" for a
-- single broccoli). Display-only metadata on the storefront; the selling unit
-- ("1 pcs") stays pure so order-time validation and inventory deduction are
-- unaffected. The catalog's legacy weight_options JSONB is left untouched.
ALTER TABLE mart_store_products
  ADD COLUMN IF NOT EXISTS approx_weight TEXT DEFAULT NULL;