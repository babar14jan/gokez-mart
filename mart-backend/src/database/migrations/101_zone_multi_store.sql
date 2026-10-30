-- Migration 101: Zones as multi-store groupings
--
-- A zone becomes the customer-facing unit: the super admin creates a zone
-- (name, centre lat/lng, radius), tags any number of stores into it, and
-- picks one of them as the zone's primary store (the "head"). The customer
-- app sees the zone head's name/address, browses the combined catalog of all
-- tagged stores, and its open/close state is decided by the zone's own hours
-- and manual override rather than any single store's.
--
-- Everything here is additive. Zones that keep only one tagged store behave
-- exactly as before, so the backfill below is a no-op for behaviour.

-- ── Zone columns: primary store + zone-level hours ───────────────────────────
-- primary_store_id is the zone head; it must be one of the tagged stores.
-- opening_hours is the zone's weekly schedule (same JSONB shape as
-- mart_stores.opening_hours) so evaluateStoreOpen can run on zone data.
ALTER TABLE mart_zones ADD COLUMN IF NOT EXISTS primary_store_id UUID REFERENCES mart_stores(id) ON DELETE SET NULL;
ALTER TABLE mart_zones ADD COLUMN IF NOT EXISTS opening_hours JSONB;

-- ── Which stores belong to which zone ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_zone_stores (
  zone_id    UUID NOT NULL REFERENCES mart_zones(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (zone_id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_mart_zone_stores_store ON mart_zone_stores(store_id);

-- ── Zone-level settings: open/close override + closure window ───────────────
-- Mirrors the mart_settings keys the storefront open-state depends on, but
-- scoped to the zone. The zone's values win over every member store's.
CREATE TABLE IF NOT EXISTS mart_zone_settings (
  zone_id    UUID NOT NULL REFERENCES mart_zones(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (zone_id, key)
);

-- ── Per-item store attribution on orders ────────────────────────────────────
-- In a multi-store zone a single order's lines come from different stores
-- (vegetables from A, fruits from B, grocery from C). The order itself still
-- belongs to one store — the zone head — so the hub's per-store queues,
-- access checks and receipts keep working unchanged; this column records
-- which store actually fulfils each line.
ALTER TABLE mart_order_items ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES mart_stores(id) ON DELETE SET NULL;

-- Comma-separated list of the distinct member stores that fulfil an order's
-- lines (e.g. "Fresh Veggies, Gokez Grocery"). Kept on the order itself so
-- the receipt and customer tracking can show the combined fulfilment names
-- without re-joining order items.
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS fulfilled_by_detail TEXT;

-- ── Backfill: existing zones keep working, now as one-store zones ──────────
-- Every legacy zone already points at one store (its fulfilment store). That
-- store becomes the zone's primary store and its only tagged member, and the
-- store's opening hours + open/close settings are lifted to the zone level so
-- the customer app's zone-driven open state computes identically from day
-- one.
UPDATE mart_zones SET primary_store_id = store_id WHERE primary_store_id IS NULL;

INSERT INTO mart_zone_stores (zone_id, store_id)
  SELECT z.id, z.primary_store_id FROM mart_zones z WHERE z.primary_store_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE mart_zones z
  SET opening_hours = s.opening_hours
  FROM mart_stores s
  WHERE z.opening_hours IS NULL AND s.id = z.primary_store_id;

-- Lift the five open-state keys. Zone rows are authoritative once present;
-- ON CONFLICT DO NOTHING means a zone that already has a manually edited
-- value keeps it.
INSERT INTO mart_zone_settings (zone_id, key, value)
  SELECT z.id, ms.key, ms.value
  FROM mart_zones z
  JOIN mart_stores s ON s.id = z.primary_store_id
  JOIN mart_settings ms ON ms.store_id = s.id
   AND ms.key IN ('store_open', 'store_closed_from', 'store_closed_until',
                  'store_closed_message', 'store_closed_greeting')
ON CONFLICT (zone_id, key) DO NOTHING;
