-- Migration 123: normalise category slugs to the canonical lowercase form.
--
-- The storefront and Home/Fresh configs compare slugs case-insensitively, but
-- keeping the stored value lowercase avoids silent mismatches (e.g. an old
-- "Fruits" row not matching a "fruits" config). New slugs are validated by
-- the admin and the backend; this migration cleans up legacy rows.

UPDATE mart_categories
SET slug = LOWER(slug)
WHERE slug <> LOWER(slug);

-- Any legacy config that stored an uppercase slug should be lowercased too.
UPDATE mart_home_sections
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{categorySlugs}',
  COALESCE(
    (SELECT jsonb_agg(LOWER(x::text)) FROM jsonb_array_elements_text(COALESCE(config->'categorySlugs', '[]'::jsonb)) AS x),
    '[]'::jsonb
  )
)
WHERE config ? 'categorySlugs';

UPDATE mart_home_sections
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{categorySlug}',
  to_jsonb(LOWER(COALESCE(config->>'categorySlug', '')))
)
WHERE config ? 'categorySlug'
  AND config->>'categorySlug' IS NOT NULL
  AND config->>'categorySlug' <> '';
