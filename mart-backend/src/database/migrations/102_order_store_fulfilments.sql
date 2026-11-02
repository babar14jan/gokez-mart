-- Migration 102: Per-store order fulfilment tracking
--
-- A master order belongs to the zone head store and keeps the customer-facing
-- status. Each store that contributes items to that order gets its own
-- fulfilment row so it can mark its portion prepared and delivered without
-- changing the customer-facing master status. Only the head store changes the
-- master status.
--
-- Additive: one row per (order, store) that already has items. Existing
-- delivered orders are backfilled as delivered; cancelled/terminated/failed
-- orders as cancelled; everything else starts pending.

CREATE TABLE IF NOT EXISTS mart_order_store_fulfilments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES mart_orders(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'prepared', 'delivered', 'cancelled')),
  prepared_at   TIMESTAMPTZ,
  prepared_by   UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  delivered_at  TIMESTAMPTZ,
  delivered_by  UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_mart_order_store_fulfilments_store
  ON mart_order_store_fulfilments(store_id, status);
CREATE INDEX IF NOT EXISTS idx_mart_order_store_fulfilments_order
  ON mart_order_store_fulfilments(order_id);

INSERT INTO mart_order_store_fulfilments
  (order_id, store_id, status, delivered_at)
SELECT oi.order_id,
       oi.store_id,
       CASE
         WHEN o.status = 'delivered' THEN 'delivered'
         WHEN o.status IN ('cancelled', 'terminated', 'failed_delivery') THEN 'cancelled'
         ELSE 'pending'
       END,
       CASE WHEN o.status = 'delivered' THEN o.delivered_at ELSE NULL END
  FROM mart_order_items oi
  JOIN mart_orders o ON o.id = oi.order_id
 WHERE oi.store_id IS NOT NULL
 GROUP BY oi.order_id, oi.store_id, o.status, o.delivered_at
ON CONFLICT (order_id, store_id) DO NOTHING;
