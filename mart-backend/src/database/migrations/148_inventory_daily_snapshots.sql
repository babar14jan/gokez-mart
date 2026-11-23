CREATE TABLE IF NOT EXISTS mart_inventory_daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_unit TEXT,
  unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_estimated BOOLEAN NOT NULL DEFAULT false,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, product_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_inventory_daily_snapshots_store_date
  ON mart_inventory_daily_snapshots(store_id, snapshot_date DESC);

WITH bounds AS (
  SELECT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1) AS snapshot_date,
         ((NOW() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS end_of_day
),
latest_movement AS (
  SELECT DISTINCT ON (m.store_id, m.product_id)
         m.store_id,
         m.product_id,
         m.new_balance,
         m.unit AS stock_unit
    FROM mart_inventory_movements m
    CROSS JOIN bounds bd
   WHERE m.created_at < bd.end_of_day
   ORDER BY m.store_id, m.product_id, m.created_at DESC, m.id DESC
),
quantity_basis AS (
  SELECT bd.snapshot_date,
         bd.end_of_day,
         sp.store_id,
         sp.product_id,
         COALESCE(
           lm.new_balance,
           GREATEST(
             COALESCE(sp.stock_quantity, 0) - COALESCE((
               SELECT SUM(after_movement.quantity_in - after_movement.quantity_out)
                 FROM mart_inventory_movements after_movement
                WHERE after_movement.store_id = sp.store_id
                  AND after_movement.product_id = sp.product_id
                  AND after_movement.created_at >= bd.end_of_day
             ), 0),
             0
           )
         ) AS stock_quantity,
         COALESCE(lm.stock_unit, sp.stock_unit) AS stock_unit
    FROM mart_store_products sp
    JOIN mart_products pr ON pr.id = sp.product_id
    CROSS JOIN bounds bd
    LEFT JOIN latest_movement lm
      ON lm.store_id = sp.store_id AND lm.product_id = sp.product_id
   WHERE sp.stock_quantity IS NOT NULL
     AND pr.is_bundle = false
     AND sp.availability_status <> 'hidden'
)
INSERT INTO mart_inventory_daily_snapshots
  (store_id, product_id, snapshot_date, stock_quantity, stock_unit, unit_cost, total_value, is_estimated)
SELECT qb.store_id,
       qb.product_id,
       qb.snapshot_date,
       qb.stock_quantity,
       qb.stock_unit,
       COALESCE(batch.unit_cost, movement.unit_cost, 0) AS unit_cost,
       ROUND(qb.stock_quantity * COALESCE(batch.unit_cost, movement.unit_cost, 0), 2),
       true
  FROM quantity_basis qb
  LEFT JOIN LATERAL (
    SELECT b.unit_cost
      FROM mart_purchase_batches b
     WHERE b.store_id = qb.store_id
       AND b.product_id = qb.product_id
       AND b.quantity_remaining > 0
       AND b.status <> 'voided'
       AND b.received_at < qb.end_of_day
     ORDER BY b.received_at DESC, b.id DESC
     LIMIT 1
  ) batch ON true
  LEFT JOIN LATERAL (
    SELECT m.unit_cost
      FROM mart_inventory_movements m
     WHERE m.store_id = qb.store_id
       AND m.product_id = qb.product_id
       AND m.created_at < qb.end_of_day
       AND m.unit_cost IS NOT NULL AND m.unit_cost > 0
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 1
  ) movement ON true
ON CONFLICT (store_id, product_id, snapshot_date) DO UPDATE SET
 stock_quantity = EXCLUDED.stock_quantity,
 stock_unit = EXCLUDED.stock_unit,
 unit_cost = EXCLUDED.unit_cost,
 total_value = EXCLUDED.total_value,
 is_estimated = true,
 computed_at = NOW()
WHERE mart_inventory_daily_snapshots.is_estimated = true;
