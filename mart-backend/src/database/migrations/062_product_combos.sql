-- Fixed product combos are sold as one product but fulfilled from component stock.
ALTER TABLE mart_products
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS mart_bundle_components (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  bundle_product_id    UUID NOT NULL REFERENCES mart_products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE RESTRICT,
  quantity             NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, bundle_product_id, component_product_id),
  CHECK (bundle_product_id <> component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle
  ON mart_bundle_components(store_id, bundle_product_id);

CREATE TABLE IF NOT EXISTS mart_order_item_bundle_components (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id        UUID NOT NULL REFERENCES mart_order_items(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES mart_products(id) ON DELETE RESTRICT,
  product_name         TEXT NOT NULL,
  unit                 TEXT NOT NULL,
  quantity_per_bundle  NUMERIC(10,3) NOT NULL CHECK (quantity_per_bundle > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_bundle_components_order_item
  ON mart_order_item_bundle_components(order_item_id);
