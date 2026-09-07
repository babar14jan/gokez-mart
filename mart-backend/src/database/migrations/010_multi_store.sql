-- Migration 010: Multi-store support
-- Architecture: shared product catalogue + per-store pricing/availability
-- Existing data → assigned to Shapoorji store (auto-created)

-- ── 1. Stores ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Shapoorji as the default store
INSERT INTO mart_stores (id, name, address, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Shapoorji',
  'Shapoorji, Kolkata',
  true
) ON CONFLICT (id) DO NOTHING;

-- Seed Gobra as second store
INSERT INTO mart_stores (id, name, address, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Gobra',
  'Gobra, Kolkata',
  false  -- inactive until ready to launch
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Store Products (per-store pricing/availability) ────────────────────────
-- mart_products stays as global catalogue (name, photo, description, category)
-- mart_store_products controls per-store price, unit, availability, sort_order
CREATE TABLE IF NOT EXISTS mart_store_products (
  store_id            UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  price               NUMERIC(10,2) NOT NULL,
  unit                TEXT NOT NULL DEFAULT '1 kg',
  discount_percent    NUMERIC(5,2) DEFAULT 0,
  availability_status TEXT NOT NULL DEFAULT 'available'
                      CHECK (availability_status IN ('available', 'out_of_stock', 'hidden')),
  is_available        BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, product_id)
);

-- Migrate existing mart_products → mart_store_products for Shapoorji
INSERT INTO mart_store_products (store_id, product_id, price, unit, discount_percent, availability_status, is_available, sort_order)
SELECT
  '00000000-0000-0000-0000-000000000001',
  id,
  price,
  unit,
  COALESCE(discount_percent, 0),
  COALESCE(availability_status, 'available'),
  is_available,
  sort_order
FROM mart_products
ON CONFLICT (store_id, product_id) DO NOTHING;

-- Copy same products to Gobra (same prices as starting point)
INSERT INTO mart_store_products (store_id, product_id, price, unit, discount_percent, availability_status, is_available, sort_order)
SELECT
  '00000000-0000-0000-0000-000000000002',
  id,
  price,
  unit,
  COALESCE(discount_percent, 0),
  'available',
  true,
  sort_order
FROM mart_products
ON CONFLICT (store_id, product_id) DO NOTHING;

-- ── 3. Link zones to stores ───────────────────────────────────────────────────
ALTER TABLE mart_zones ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES mart_stores(id) ON DELETE SET NULL;

-- Assign existing zones to Shapoorji by default
UPDATE mart_zones SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;

-- ── 4. Add store_id to orders ─────────────────────────────────────────────────
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES mart_stores(id) ON DELETE SET NULL;
UPDATE mart_orders SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;

-- ── 5. Per-store settings ─────────────────────────────────────────────────────
ALTER TABLE mart_settings ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES mart_stores(id) ON DELETE CASCADE;

-- Assign existing global settings to Shapoorji
UPDATE mart_settings SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;

-- Change primary key to (store_id, key)
ALTER TABLE mart_settings DROP CONSTRAINT IF EXISTS mart_settings_pkey;
ALTER TABLE mart_settings ADD PRIMARY KEY (store_id, key);

-- Copy settings to Gobra
INSERT INTO mart_settings (key, value, label, store_id)
SELECT key, value, label, '00000000-0000-0000-0000-000000000002'
FROM mart_settings
WHERE store_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (store_id, key) DO NOTHING;

-- Update Gobra store name/address settings
UPDATE mart_settings SET value = 'Gobra' WHERE store_id = '00000000-0000-0000-0000-000000000002' AND key = 'store_name';
UPDATE mart_settings SET value = 'Gobra, Kolkata' WHERE store_id = '00000000-0000-0000-0000-000000000002' AND key = 'store_address';
UPDATE mart_settings SET value = 'Gobra, Kolkata (5km radius)' WHERE store_id = '00000000-0000-0000-0000-000000000002' AND key = 'delivery_area';

-- ── 6. Add store_id to admins ─────────────────────────────────────────────────
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES mart_stores(id) ON DELETE SET NULL;
-- NULL store_id = super_admin (access to all stores)
-- Set store_id for sales_manager/staff roles
UPDATE mart_admins SET store_id = '00000000-0000-0000-0000-000000000001'
WHERE role IN ('sales_manager', 'staff') AND store_id IS NULL;

-- ── 7. Drop legacy columns from mart_products (now in mart_store_products) ───
ALTER TABLE mart_products DROP COLUMN IF EXISTS price;
ALTER TABLE mart_products DROP COLUMN IF EXISTS unit;
ALTER TABLE mart_products DROP COLUMN IF EXISTS discount_percent;
ALTER TABLE mart_products DROP COLUMN IF EXISTS is_available;
ALTER TABLE mart_products DROP COLUMN IF EXISTS sort_order;

-- ── 8. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mart_store_products_store ON mart_store_products(store_id);
CREATE INDEX IF NOT EXISTS idx_mart_store_products_product ON mart_store_products(product_id);
CREATE INDEX IF NOT EXISTS idx_mart_orders_store ON mart_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_mart_zones_store ON mart_zones(store_id);
