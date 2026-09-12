-- Seed inventory settings for all existing stores
INSERT INTO mart_settings (store_id, key, value, label)
SELECT s.id, v.key, v.value, v.label
FROM mart_stores s
CROSS JOIN (VALUES
  ('inventory_tracking',  'false',    'Enable Inventory Tracking'),
  ('auto_out_of_stock',   'on_zero',  'Auto mark Out of Stock when qty hits 0'),
  ('low_stock_threshold', '5',        'Low Stock Alert Threshold (units)')
) AS v(key, value, label)
ON CONFLICT (store_id, key) DO NOTHING;
