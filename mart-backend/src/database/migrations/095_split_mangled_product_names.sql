-- Migration 095: split mangled product names back into a name and aliases
--
-- A few catalogue rows were created with several names typed into the "name"
-- field, separated by runs of spaces:
--
--   "Organic Tejaswini Green Chilli   Tejaswini Kancha Lanka   Te"
--
-- The extra names were meant to be search aliases, but they ended up in the
-- name, and the aliases column stayed empty. Two problems followed:
--   * the product displayed with a run of spaces and a chopped-off tail
--   * the name exceeded the new 40-character limit (see
--     product.service.ts MAX_PRODUCT_NAME_LENGTH), so editing the product in
--     the hub would be rejected by the API until the name was fixed by hand
--
-- This splits such a name on its runs of two or more spaces: the first part
-- stays the name, the rest become search aliases (merged with any aliases
-- already stored, de-duplicated, so nothing is lost). It is written to be
-- generic rather than to target specific rows, so the same mess in any other
-- store is cleaned too. Rows whose name is a single clean phrase are
-- untouched.

-- Runs of two or more spaces are the separator between the name and the extra
-- names. They are turned into tabs so the parts can be split apart; single
-- spaces inside a name are left alone.
WITH normalised AS (
  SELECT
    p.id,
    regexp_replace(btrim(p.name), '[[:space:]]{2,}', E'\t', 'g') AS parts
  FROM mart_products p
  WHERE p.name ~ '[^[:space:]][[:space:]]{2,}[^[:space:]]'
),
split AS (
  SELECT
    id,
    -- The first part is the name.
    split_part(parts, E'\t', 1) AS first_part,
    -- The rest are the extra names. An array slice from the second element to
    -- the end, so a name with three parts yields two aliases.
    CASE
      WHEN array_length(arr, 1) > 1 THEN arr[2:]
      ELSE NULL
    END AS rest
  FROM (
    SELECT id, parts, string_to_array(parts, E'\t') AS arr
    FROM normalised
  ) chunked
)
UPDATE mart_products p
SET
  name = s.first_part,
  search_aliases = (
    SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}'::text[])
    FROM (
      -- The aliases already stored on the product...
      SELECT unnest(COALESCE(p.search_aliases, '{}'::text[])) AS a
      UNION
      -- ...plus the ones lifted out of the name field.
      SELECT unnest(s.rest)
    ) list
    WHERE a <> ''
  ),
  updated_at = NOW()
FROM split s
WHERE p.id = s.id
  AND s.rest IS NOT NULL;
