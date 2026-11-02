-- Stable, category-scoped product codes. This migration is intentionally
-- self-contained because it has not been deployed yet.
ALTER TABLE mart_categories
  ADD COLUMN IF NOT EXISTS product_prefix TEXT,
  ADD COLUMN IF NOT EXISTS product_code_sequence INTEGER NOT NULL DEFAULT 0;

-- Prefer a readable prefix based on slug/name. Collisions receive a deterministic
DO $$
DECLARE
  category_record RECORD;
  normalized_prefix TEXT;
  normalized_category TEXT;
  candidate_prefix TEXT;
  fallback_number INTEGER;
BEGIN
  FOR category_record IN
    SELECT id, slug, name
    FROM mart_categories
    WHERE product_prefix IS NULL OR BTRIM(product_prefix) = ''
  LOOP
    normalized_category := REGEXP_REPLACE(
      LOWER(COALESCE(NULLIF(BTRIM(category_record.slug), ''), BTRIM(category_record.name))),
      '[^a-z]', '', 'g'
    );
    normalized_prefix := REGEXP_REPLACE(
      UPPER(COALESCE(NULLIF(category_record.slug, ''), category_record.name)),
      '[^A-Z]', '', 'g'
    );
    candidate_prefix := CASE normalized_category
      WHEN 'vegetables' THEN 'VEG'
      WHEN 'freshvegetables' THEN 'VEG'
      WHEN 'fruits' THEN 'FRT'
      WHEN 'freshfruits' THEN 'FRT'
      WHEN 'dairy' THEN 'DAI'
      WHEN 'dairyproduct' THEN 'DAI'
      ELSE CASE
      WHEN LENGTH(normalized_prefix) >= 2 THEN LEFT(normalized_prefix, 6)
      WHEN LENGTH(normalized_prefix) = 1 THEN normalized_prefix || 'X'
      ELSE 'CAT'
      END
    END;

    IF EXISTS (SELECT 1 FROM mart_categories WHERE product_prefix = candidate_prefix) THEN
      fallback_number := 0;
      LOOP
        IF fallback_number >= 17576 THEN
          RAISE EXCEPTION 'Unable to allocate a unique category product prefix';
        END IF;
        candidate_prefix := 'CAT'
          || CHR(65 + (fallback_number / 676))
          || CHR(65 + ((fallback_number / 26) % 26))
          || CHR(65 + (fallback_number % 26));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM mart_categories WHERE product_prefix = candidate_prefix);
        fallback_number := fallback_number + 1;
      END LOOP;
    END IF;

    UPDATE mart_categories
    SET product_prefix = candidate_prefix
    WHERE id = category_record.id;
  END LOOP;
END $$;

ALTER TABLE mart_categories
  ALTER COLUMN product_prefix SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mart_categories_product_prefix_format'
  ) THEN
    ALTER TABLE mart_categories
      ADD CONSTRAINT mart_categories_product_prefix_format
      CHECK (product_prefix ~ '^[A-Z]{2,6}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_categories_product_prefix_upper
  ON mart_categories (UPPER(product_prefix));

ALTER TABLE mart_products
  ADD COLUMN IF NOT EXISTS product_code TEXT;

ALTER TABLE mart_products
  ALTER COLUMN product_code DROP DEFAULT;

-- Existing products are numbered independently within each category. The
-- migration is unreleased, so any partial GM values are replaced here.
WITH numbered_products AS (
  SELECT p.id,
         COALESCE(c.product_prefix, 'GM') AS product_prefix,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(c.product_prefix, 'GM')
           ORDER BY p.created_at ASC, p.id ASC
         ) AS sequence_number
  FROM mart_products p
  LEFT JOIN mart_categories c ON c.id = p.category_id
)
UPDATE mart_products p
SET product_code = numbered_products.product_prefix || '-'
  || LPAD(numbered_products.sequence_number::TEXT, 4, '0')
FROM numbered_products
WHERE p.id = numbered_products.id;

UPDATE mart_categories c
SET product_code_sequence = COALESCE((
  SELECT COUNT(*)::INTEGER
  FROM mart_products p
  WHERE p.category_id = c.id
), 0);

CREATE SEQUENCE IF NOT EXISTS mart_product_uncategorized_code_seq START WITH 1;

SELECT setval(
  'mart_product_uncategorized_code_seq',
  COALESCE(MAX((SUBSTRING(product_code FROM '^GM-([0-9]+)$'))::BIGINT), 1),
  COUNT(*) FILTER (WHERE product_code ~ '^GM-[0-9]+$') > 0
)
FROM mart_products;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mart_products_product_code_format'
  ) THEN
    ALTER TABLE mart_products
      ADD CONSTRAINT mart_products_product_code_format
      CHECK (product_code ~ '^[A-Z]{2,6}-[0-9]{4,}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_products_product_code
  ON mart_products(product_code);

CREATE OR REPLACE FUNCTION mart_assign_product_code()
RETURNS TRIGGER AS $$
DECLARE
  category_prefix TEXT;
  next_sequence INTEGER;
BEGIN
  IF COALESCE(BTRIM(NEW.product_code), '') <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.category_id IS NOT NULL THEN
    UPDATE mart_categories
    SET product_code_sequence = product_code_sequence + 1
    WHERE id = NEW.category_id
    RETURNING product_prefix, product_code_sequence INTO category_prefix, next_sequence;
  END IF;

  IF category_prefix IS NOT NULL THEN
    NEW.product_code := category_prefix || '-' || LPAD(next_sequence::TEXT, 4, '0');
  ELSE
    NEW.product_code := 'GM-' || LPAD(nextval('mart_product_uncategorized_code_seq')::TEXT, 4, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mart_assign_product_code_before_insert ON mart_products;
CREATE TRIGGER mart_assign_product_code_before_insert
  BEFORE INSERT ON mart_products
  FOR EACH ROW EXECUTE FUNCTION mart_assign_product_code();

CREATE OR REPLACE FUNCTION mart_prevent_used_category_prefix_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_prefix IS DISTINCT FROM OLD.product_prefix
     AND EXISTS (SELECT 1 FROM mart_products WHERE category_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot change product prefix after products exist for this category';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mart_prevent_used_category_prefix_change_before_update ON mart_categories;
CREATE TRIGGER mart_prevent_used_category_prefix_change_before_update
  BEFORE UPDATE OF product_prefix ON mart_categories
  FOR EACH ROW EXECUTE FUNCTION mart_prevent_used_category_prefix_change();