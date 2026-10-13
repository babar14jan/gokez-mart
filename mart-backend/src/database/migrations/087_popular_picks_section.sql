-- Migration 087: rename the default favourites section and remove its subtitle.
--
-- Keep merchant-customized section copy intact.
UPDATE mart_home_sections
SET title = 'Popular picks', subtitle = NULL, updated_at = NOW()
WHERE section_key = 'top_picks'
  AND title = 'Store Favourites'
  AND subtitle = 'Loved by our shoppers';