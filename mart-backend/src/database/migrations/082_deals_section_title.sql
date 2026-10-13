-- Migration 082: rename the Deals section to "Today's Deals".
--
-- The section is otherwise unchanged (it auto-lists every discounted product,
-- biggest discount first). The guard keeps a title an admin has since customised
-- via Hub → Home Sections untouched.
UPDATE mart_home_sections
SET title = 'Today''s Deals', updated_at = NOW()
WHERE section_key = 'deals' AND title = 'Deals of the Day';
