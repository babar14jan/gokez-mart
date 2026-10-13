-- Migration 085: refresh the default Store Favourites subtitle.
--
-- Keep merchant-written subtitles intact; only replace the previous seeded copy.
UPDATE mart_home_sections
SET subtitle = 'Loved by our shoppers', updated_at = NOW()
WHERE section_key = 'top_picks'
  AND subtitle = 'Hand-picked favourites';