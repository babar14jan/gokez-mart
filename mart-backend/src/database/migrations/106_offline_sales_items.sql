-- Migration 106: Itemised offline counter sales
--
-- Replaces the day-level aggregate draft from migration 105 (one row per store
-- per day holding a UPI-scanner total and a cash total) with one row per item
-- sold at the counter. Staff search an existing store product, enter the
-- quantity and pick cash or UPI, exactly like a customer adds to the cart.
--
-- The daily-sales ledger still computes app-order figures live from
-- mart_orders; only these offline rows are stored. A day's offline cash/UPI
-- split is then a SUM over this table, so the reconciliation totals cannot
-- drift from the individual rows.
--
-- Price is snapshotted at entry time (name/unit/price are copied from the
-- store listing) so later catalogue edits cannot rewrite history.

CREATE TABLE IF NOT EXISTS mart_offline_sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  sale_date      DATE NOT NULL,
  product_id     UUID REFERENCES mart_products(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL,
  unit           TEXT NOT NULL,
  unit_price     NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity       NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  total          NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi')),
  notes          TEXT,
  recorded_by    UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_offline_sales_store_date
  ON mart_offline_sales(store_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_mart_offline_sales_product
  ON mart_offline_sales(product_id);

-- Preserve any aggregate rows already recorded through the migration-105
-- draft as two synthetic itemised rows before dropping the old table, so a
-- dev database that was already used does not silently lose its totals.
DO $$
BEGIN
  IF to_regclass('mart_daily_sales') IS NOT NULL THEN
    INSERT INTO mart_offline_sales
      (store_id, sale_date, product_id, product_name, unit, unit_price, quantity, total, payment_method, notes, recorded_by)
    SELECT store_id, sale_date, NULL, 'Offline cash (legacy total)', '—',
           offline_cash, 1, offline_cash, 'cash', notes, recorded_by
      FROM mart_daily_sales
     WHERE offline_cash > 0;

    INSERT INTO mart_offline_sales
      (store_id, sale_date, product_id, product_name, unit, unit_price, quantity, total, payment_method, notes, recorded_by)
    SELECT store_id, sale_date, NULL, 'Offline UPI scanner (legacy total)', '—',
           upi_scanner_total, 1, upi_scanner_total, 'upi', notes, recorded_by
      FROM mart_daily_sales
     WHERE upi_scanner_total > 0;

    DROP TABLE mart_daily_sales;
  END IF;
END $$;
