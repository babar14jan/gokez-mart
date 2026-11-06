-- Migration 124: enforce one Fresh page config per store.
--
-- The storefront assumes a single `fresh` row per store (its tabs and display
-- settings). Keep the earliest/lowest-ordered row when duplicates exist, then
-- add a partial unique index so the database is the source of truth.

DELETE FROM mart_home_sections a
USING mart_home_sections b
WHERE a.kind = 'fresh'
  AND b.kind = 'fresh'
  AND a.store_id = b.store_id
  AND (
        a.sort_order > b.sort_order
        OR (a.sort_order = b.sort_order AND a.created_at > b.created_at)
        OR (a.sort_order = b.sort_order AND a.created_at = b.created_at AND a.id > b.id)
      );

CREATE UNIQUE INDEX IF NOT EXISTS ux_mart_home_sections_one_fresh_per_store
  ON mart_home_sections (store_id)
  WHERE kind = 'fresh';
