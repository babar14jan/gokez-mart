-- Migration 083: rename the Top Picks section to "Store Favourites".
--
-- Now that top_picks auto-fills from bestsellers when no products are picked,
-- "Top Picks" (implying a popularity ranking) is misleading — the store person
-- curates it. The guard keeps a title an admin has since customised untouched.
UPDATE mart_home_sections
SET title = 'Store Favourites', updated_at = NOW()
WHERE section_key = 'top_picks' AND title = 'Today''s Top Picks';