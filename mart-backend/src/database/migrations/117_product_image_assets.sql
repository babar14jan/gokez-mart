-- Tracks generated product image pairs so pending uploads and removed images can
-- be cleaned from storage without scanning or guessing from public URLs.
CREATE TABLE IF NOT EXISTS mart_product_image_assets (
  id UUID PRIMARY KEY,
  product_id UUID REFERENCES mart_products(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  thumbnail_url TEXT NOT NULL,
  large_url TEXT NOT NULL,
  thumbnail_key TEXT NOT NULL,
  large_key TEXT NOT NULL,
  storage_driver TEXT NOT NULL CHECK (storage_driver IN ('local', 'supabase')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cleanup_queued')),
  sort_order SMALLINT,
  cleanup_after TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mart_product_image_assets_product
  ON mart_product_image_assets (product_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_mart_product_image_assets_cleanup
  ON mart_product_image_assets (status, cleanup_after)
  WHERE status IN ('pending', 'cleanup_queued');
