-- Change stock_quantity from INTEGER to NUMERIC (supports 0.1 kg decimals)
ALTER TABLE mart_store_products
  ALTER COLUMN stock_quantity TYPE NUMERIC(10,3) USING stock_quantity::NUMERIC,
  ALTER COLUMN low_stock_threshold TYPE NUMERIC(10,3) USING low_stock_threshold::NUMERIC,
  ADD COLUMN IF NOT EXISTS stock_unit TEXT DEFAULT NULL;

-- Change log change_qty to NUMERIC too
ALTER TABLE mart_inventory_log
  ALTER COLUMN change_qty TYPE NUMERIC(10,3) USING change_qty::NUMERIC;
