-- Migration 079: Configurable homepage sections (per store)
--
-- The storefront homepage renders these sections in `sort_order` instead of a
-- hardcoded layout. Each row describes one section; `config` carries the small
-- amount of per-section settings we need (currently just the category slug a
-- section is scoped to). Section content itself is never stored here — product
-- sections resolve live from the existing products/bundles tables, so prices and
-- availability are never duplicated or allowed to go stale.

CREATE TABLE IF NOT EXISTS mart_home_sections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  section_key  TEXT NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_enabled   BOOLEAN NOT NULL DEFAULT true,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_home_sections_store
  ON mart_home_sections(store_id, sort_order);

-- Seed the two default sections for every existing store. `ON CONFLICT DO NOTHING`
-- keeps this idempotent and, crucially, never clobbers config an admin has since
-- edited. Combos default to an unscoped scope (all bundle products — the catalogue
-- is vegetable-only), while Fresh Vegetables is pinned to the vegetables category.
INSERT INTO mart_home_sections (store_id, section_key, title, subtitle, sort_order, is_enabled, config)
SELECT id, 'todays_combos', 'Today''s Combos', 'Fresh combos, packed today', 1, true,
       '{}'::jsonb
FROM mart_stores
ON CONFLICT (store_id, section_key) DO NOTHING;

INSERT INTO mart_home_sections (store_id, section_key, title, subtitle, sort_order, is_enabled, config)
SELECT id, 'fresh_vegetables', 'Fresh Vegetables', 'Picked fresh for your kitchen', 2, true,
       '{"categorySlug":"vegetables"}'::jsonb
FROM mart_stores
ON CONFLICT (store_id, section_key) DO NOTHING;
