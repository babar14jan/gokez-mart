-- Migration 088: remove the default Today's Combos subtitle.
--
-- Keep merchant-written subtitles intact.
UPDATE mart_home_sections
SET subtitle = NULL, updated_at = NOW()
WHERE section_key = 'todays_combos'
  AND subtitle = 'Fresh combos, packed today';