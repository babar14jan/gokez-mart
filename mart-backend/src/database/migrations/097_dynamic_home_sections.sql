-- Migration 097: Dynamic home sections
--
-- Turns home sections from a fixed set of keys into a generic merchandising
-- canvas. The migration runner already wraps this file in a transaction; do
-- not add transaction control here.

-- A previous local-only draft used this migration body under a different
-- filename. It may have renamed the column without recording its filename, so
-- resume safely when that schema change is already present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'mart_home_sections'::regclass
      AND attname = 'section_key'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE mart_home_sections RENAME COLUMN section_key TO kind;
  END IF;
END $$;

-- Drop the per-type uniqueness so a store can have multiple shelves.
ALTER TABLE mart_home_sections
  DROP CONSTRAINT IF EXISTS mart_home_sections_store_id_section_key_key;

ALTER TABLE mart_home_sections
  ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'row',
  ADD COLUMN IF NOT EXISTS badge  TEXT,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visibility_rule TEXT DEFAULT 'always';

-- Preserve the legacy Store Favourites behavior: when no products were
-- curated, it used to resolve to store bestsellers.
UPDATE mart_home_sections
SET kind = 'manual',
    config = jsonb_set(COALESCE(config, '{}'::jsonb), '{fallback}', '"bestsellers"'::jsonb)
WHERE kind IN ('top_picks', 'store_favourites', 'popular_picks');

UPDATE mart_home_sections SET kind = 'combo' WHERE kind = 'todays_combos';
UPDATE mart_home_sections SET kind = 'category' WHERE kind = 'fresh_vegetables';
UPDATE mart_home_sections SET kind = 'deals' WHERE kind = 'deals';
UPDATE mart_home_sections SET kind = 'manual'
WHERE kind NOT IN ('manual','category','combo','deals','bestsellers','new_arrivals','buy_again','banner','category_tiles');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mart_home_sections'::regclass
      AND conname = 'mart_home_sections_kind_check'
  ) THEN
    ALTER TABLE mart_home_sections
      ADD CONSTRAINT mart_home_sections_kind_check
      CHECK (kind IN ('manual','category','combo','deals','bestsellers','new_arrivals','buy_again','banner','category_tiles'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mart_home_sections'::regclass
      AND conname = 'mart_home_sections_layout_check'
  ) THEN
    ALTER TABLE mart_home_sections
      ADD CONSTRAINT mart_home_sections_layout_check
      CHECK (layout IN ('row','grid','hero','tiles'));
  END IF;
END $$;

-- Keep existing values when present; backfill only the defaults required by
-- the new resolver.
UPDATE mart_home_sections
SET config = jsonb_set(
             jsonb_set(
               jsonb_set(COALESCE(config, '{}'::jsonb), '{categorySlugs}', COALESCE(config->'categorySlugs', '[]'::jsonb)),
               '{fallback}', COALESCE(config->'fallback', '"none"'::jsonb)),
             '{sort}', COALESCE(config->'sort', '"catalogue"'::jsonb));

CREATE INDEX IF NOT EXISTS idx_home_sections_store_sort
  ON mart_home_sections(store_id, sort_order);