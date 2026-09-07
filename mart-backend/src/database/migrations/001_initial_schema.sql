-- Gokez Mart — Initial Schema
-- All tables prefixed with mart_ to coexist with Mobility in same Supabase DB

-- ── Categories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  icon        TEXT,                    -- emoji or icon name
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID REFERENCES mart_categories(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  photo_url        TEXT,
  price            NUMERIC(10,2) NOT NULL,
  unit             TEXT NOT NULL DEFAULT '1 kg',   -- e.g. "500g", "1 kg", "1 piece"
  weight_options   JSONB,                           -- [{"label":"500g","price":30},{"label":"1kg","price":55}]
  discount_percent NUMERIC(5,2) DEFAULT 0,
  is_available     BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Settings ──────────────────────────────────────────────────────────────────
-- All configurable values stored as key-value pairs
-- Admin can update any of these from the admin portal
CREATE TABLE IF NOT EXISTS mart_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT,                    -- human-readable label for admin UI
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default settings — all configurable from admin portal
INSERT INTO mart_settings (key, value, label) VALUES
  ('store_name',            'Gokez Mart',                          'Store Name'),
  ('store_address',         'Shapoorji, Kolkata',                  'Store Address'),
  ('whatsapp_number',       '918777376280',                        'WhatsApp Order Number'),
  ('upi_id',                '',                                    'UPI ID'),
  ('upi_phone',             '',                                    'UPI Phone Number'),
  ('phonepay_qr_url',       '',                                    'PhonePe QR Code URL'),
  ('delivery_charge',       '15',                                  'Delivery Charge (₹)'),
  ('free_delivery_above',   '150',                                 'Free Delivery Above (₹)'),
  ('min_order_amount',      '50',                                  'Minimum Order Amount (₹)'),
  ('delivery_area',         'Shapoorji, Kolkata (5km radius)',     'Delivery Area'),
  ('store_open',            'true',                                'Store Open'),
  ('estimated_delivery',    '30-45 mins',                          'Estimated Delivery Time'),
  ('cod_enabled',           'true',                                'Cash on Delivery'),
  ('upi_enabled',           'true',                                'UPI Payment'),
  ('phonepay_enabled',      'false',                               'PhonePe QR Payment')
ON CONFLICT (key) DO NOTHING;

-- ── Admins ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Customers ─────────────────────────────────────────────────────────────────
-- Built from guest orders — no registration required
CREATE TABLE IF NOT EXISTS mart_customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL UNIQUE,
  name         TEXT,
  address      TEXT,
  order_count  INTEGER NOT NULL DEFAULT 0,
  total_spent  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Orders ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     TEXT NOT NULL UNIQUE,   -- MART-001, MART-002 etc
  customer_id      UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  guest_name       TEXT NOT NULL,
  guest_phone      TEXT NOT NULL,
  guest_address    TEXT NOT NULL,
  subtotal         NUMERIC(10,2) NOT NULL,
  delivery_charge  NUMERIC(10,2) NOT NULL DEFAULT 15,
  discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  total            NUMERIC(10,2) NOT NULL,
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('cod', 'upi', 'phonepay')),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  whatsapp_sent    BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Order Items ───────────────────────────────────────────────────────────────
-- Snapshot of product at time of order — price changes don't affect history
CREATE TABLE IF NOT EXISTS mart_order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES mart_orders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES mart_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,    -- snapshot
  unit         TEXT NOT NULL,    -- snapshot
  price        NUMERIC(10,2) NOT NULL,  -- snapshot
  quantity     INTEGER NOT NULL DEFAULT 1,
  total        NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mart_products_category ON mart_products(category_id);
CREATE INDEX IF NOT EXISTS idx_mart_products_available ON mart_products(is_available);
CREATE INDEX IF NOT EXISTS idx_mart_orders_phone ON mart_orders(guest_phone);
CREATE INDEX IF NOT EXISTS idx_mart_orders_status ON mart_orders(status);
CREATE INDEX IF NOT EXISTS idx_mart_orders_created ON mart_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mart_order_items_order ON mart_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_mart_customers_phone ON mart_customers(phone);

-- ── Seed categories ───────────────────────────────────────────────────────────
INSERT INTO mart_categories (name, slug, icon, sort_order) VALUES
  ('Vegetables',       'vegetables',   '🥦', 1),
  ('Dairy & Paneer',   'dairy',        '🧀', 2),
  ('Mushrooms & Greens','mushrooms',   '🍄', 3),
  ('Spices & Masalas', 'spices',       '🌶️', 4),
  ('Daily Essentials', 'essentials',   '🛒', 5)
ON CONFLICT (slug) DO NOTHING;
