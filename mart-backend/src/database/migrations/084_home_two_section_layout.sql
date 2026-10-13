-- Migration 084: home shows only Combos + Store Favourites, 2-per-row.
--
-- The storefront home is intentionally minimal: Today's Combos first, then
-- Store Favourites. Fresh Vegetables and Today's Deals are switched off (they
-- stay in the table with their config and can be re-enabled from Hub → Home
-- Sections at any time), and the two live sections get stable sort orders.
UPDATE mart_home_sections
SET sort_order = CASE section_key
      WHEN 'todays_combos'     THEN 1
      WHEN 'top_picks'         THEN 2
      WHEN 'fresh_vegetables'  THEN 3
      WHEN 'deals'             THEN 4
      ELSE sort_order END,
    is_enabled = section_key IN ('todays_combos', 'top_picks'),
    updated_at = NOW();