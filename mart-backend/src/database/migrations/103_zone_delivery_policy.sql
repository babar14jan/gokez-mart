-- Delivery promise and cart policy are zone-owned. Preserve current behaviour
-- by lifting the head store's existing values onto each zone once.
INSERT INTO mart_zone_settings (zone_id, key, value, updated_at)
SELECT z.id, s.key, s.value, NOW()
  FROM mart_zones z
  JOIN mart_settings s ON s.store_id = z.primary_store_id
 WHERE s.key IN ('estimated_delivery', 'delivery_charge', 'free_delivery_above', 'min_order_amount')
ON CONFLICT (zone_id, key) DO NOTHING;