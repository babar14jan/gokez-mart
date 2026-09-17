-- Migration 039: Campaign Management System

CREATE TABLE IF NOT EXISTS mart_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  subtitle            TEXT,
  description         TEXT,
  badge_text          TEXT,                          -- e.g. "🎉 New User"

  -- Discount
  discount_type       TEXT NOT NULL DEFAULT 'flat'
                      CHECK (discount_type IN ('flat','percent','free_delivery','none')),
  discount_value      NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount        NUMERIC(10,2),                 -- cap for percent type
  min_order_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Redemption
  coupon_code         TEXT UNIQUE,                   -- null = auto-applied
  new_customers_only  BOOLEAN NOT NULL DEFAULT false,
  per_customer_limit  INT NOT NULL DEFAULT 1,
  usage_limit         INT,                           -- null = unlimited
  usage_count         INT NOT NULL DEFAULT 0,

  -- Scope
  store_id            UUID REFERENCES mart_stores(id) ON DELETE CASCADE,  -- null = all stores

  -- Carousel
  show_in_carousel    BOOLEAN NOT NULL DEFAULT false,
  carousel_image_url  TEXT,
  carousel_gradient   TEXT DEFAULT 'from-emerald-500 via-teal-500 to-cyan-500',
  carousel_sort_order INT NOT NULL DEFAULT 0,

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','active','scheduled','expired')),
  valid_from          TIMESTAMPTZ,
  valid_until         TIMESTAMPTZ,

  created_by          UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status    ON mart_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_store     ON mart_campaigns(store_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_code      ON mart_campaigns(coupon_code);
CREATE INDEX IF NOT EXISTS idx_campaigns_carousel  ON mart_campaigns(show_in_carousel, carousel_sort_order);
