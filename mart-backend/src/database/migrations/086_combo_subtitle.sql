-- Migration 086: refresh the default Today's Combos subtitle.
--
-- Keep merchant-written subtitles intact; only replace the previous seeded copy.
UPDATE mart_home_sections
SET subtitle = 'Fresh combos, packed today', updated_at = NOW()
WHERE section_key = 'todays_combos'
  AND subtitle = 'Fresh vegetable combos, packed today';