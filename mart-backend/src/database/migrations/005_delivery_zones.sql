-- Migration 005: Delivery zones
CREATE TABLE IF NOT EXISTS mart_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  lat        NUMERIC(10,7) NOT NULL,
  lng        NUMERIC(10,7) NOT NULL,
  radius_km  NUMERIC(5,2) NOT NULL DEFAULT 5,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial zones
INSERT INTO mart_zones (name, lat, lng, radius_km, is_active, sort_order) VALUES
  ('Shapoorji', 22.565717182227967, 88.51426843552692, 5, true, 1),
  ('Gobra',     22.54117122028785,  88.37764963965188, 3, true, 2)
ON CONFLICT DO NOTHING;
