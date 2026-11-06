-- Migration 122: Fresh page config section kind
--
-- The middle "Fresh" nav button is configured from the same Home Sections page
-- as the rest of the storefront. A `fresh` row is a page config (not a shelf):
-- its `config.categorySlugs` are the Fresh tabs in order and `columns`/`limit`
-- control how products display. Listing only the fresh categories here is what
-- keeps Grocery and other non-fresh categories out of the Fresh page.

ALTER TABLE mart_home_sections
  DROP CONSTRAINT IF EXISTS mart_home_sections_kind_check;

ALTER TABLE mart_home_sections
  ADD CONSTRAINT mart_home_sections_kind_check
  CHECK (kind IN (
    'manual','category','combo','deals','bestsellers','new_arrivals',
    'buy_again','banner','category_tiles','fresh'
  ));

-- Seed one Fresh config per store so the page works immediately and the head
-- store can edit it. Empty/absent config still falls back to Vegetables in the
-- storefront. Idempotent: never overwrites an existing Fresh row.
INSERT INTO mart_home_sections (store_id, kind, title, subtitle, sort_order, is_enabled, layout, config)
SELECT s.id, 'fresh', 'Fresh', NULL, 0, true, 'grid',
       '{"categorySlugs":["vegetables"],"columns":3}'::jsonb
FROM mart_stores s
WHERE NOT EXISTS (
  SELECT 1 FROM mart_home_sections hs
  WHERE hs.store_id = s.id AND hs.kind = 'fresh'
);
