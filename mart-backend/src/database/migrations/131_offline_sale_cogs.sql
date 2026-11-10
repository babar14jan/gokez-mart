-- Migration 131: store COGS and gross profit on offline sales.
ALTER TABLE mart_offline_sales
  ADD COLUMN IF NOT EXISTS cost_of_goods NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS gross_profit NUMERIC(12,2);
