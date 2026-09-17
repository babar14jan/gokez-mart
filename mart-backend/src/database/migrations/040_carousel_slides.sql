-- Migration 040: Configurable Carousel Slides

CREATE TABLE IF NOT EXISTS mart_carousel_slides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT,
  subtitle    TEXT,
  image_url   TEXT,                          -- uploaded image
  gradient    TEXT DEFAULT 'from-emerald-500 via-teal-500 to-cyan-500',
  campaign_id UUID REFERENCES mart_campaigns(id) ON DELETE SET NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carousel_active ON mart_carousel_slides(is_active, sort_order);

-- Seed the 3 existing images as carousel slides
INSERT INTO mart_carousel_slides (title, subtitle, image_url, sort_order, is_active)
VALUES
  ('Shop local. Support local.', 'Fresh from your neighbourhood', '/1.webp', 1, true),
  ('Farm fresh every day',        'Sourced directly from local vendors', '/2.webp', 2, true),
  ('Bringing local stores online','Your neighbourhood store, now at your door', '/3.webp', 3, true)
ON CONFLICT DO NOTHING;
