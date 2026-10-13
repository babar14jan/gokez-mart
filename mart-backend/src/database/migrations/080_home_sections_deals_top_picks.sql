-- Migration 080: Deals + Top Picks homepage sections
--
-- Adds two more configurable section types on top of 079:
--   * `deals`     — auto-sourced from products whose discount_percent > 0. A
--                   "deal" is therefore just a discounted catalogue item, so
--                   prices stay server-authoritative (order.service recomputes
--                   the effective price from price/discount_percent).
--   * `top_picks` — Store Favourites. A hand-picked, ordered list of products
--                   stored in config.productIds. Empty until an admin curates
--                   it; while empty, the storefront auto-fills it with the
--                   store's bestsellers so the row is never empty.
--
-- Both default to disabled so existing storefronts are unaffected until an
-- admin turns them on; the storefront also skips any section that resolves to
-- zero products (e.g. no discounted items yet).
INSERT INTO mart_home_sections (store_id, section_key, title, subtitle, sort_order, is_enabled, config)
SELECT id, 'deals', 'Today''s Deals', 'Save more on everyday essentials', 3, false,
       '{}'::jsonb
FROM mart_stores
ON CONFLICT (store_id, section_key) DO NOTHING;

INSERT INTO mart_home_sections (store_id, section_key, title, subtitle, sort_order, is_enabled, config)
SELECT id, 'top_picks', 'Store Favourites', 'Loved by our shoppers', 4, false,
       '{}'::jsonb
FROM mart_stores
ON CONFLICT (store_id, section_key) DO NOTHING;

-- Backfill config keys for the sections that already exist from 079 so the
-- service can rely on a stable shape. `||` merges without clobbering an
-- existing value.
UPDATE mart_home_sections
SET config = config || '{"productIds":[],"limit":null,"layout":null}'::jsonb
WHERE section_key IN ('todays_combos', 'fresh_vegetables', 'deals', 'top_picks');
