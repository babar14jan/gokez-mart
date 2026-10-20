-- Migration 091: Product suggestions ("Suggest products").
--
-- Customer-initiated demand capture. A shopper (guest or signed-in) tells us
-- what they would like us to stock. This is deliberately NOT an order and NOT a
-- lead: it is a demand signal the super admin reviews to decide what to bring in.
--
-- Context is captured at submit time (and denormalised) so the insight survives
-- a zone/store rename and so the hub can slice demand by area and by buyer type
-- without re-deriving anything:
--   * zone_id / zone_name   — the delivery area the customer was shopping in.
--   * store_id / store_name — the fulfilment store for that area.
--   * buyer_type            — 'new' (no delivered order yet) or 'repeat'.
--   * order_count           — the customer's completed orders at submit time.
--
-- customer_id is NULL for a guest; phone is kept either way so a guest ask can
-- still be tied to a number if they later sign in.

CREATE TABLE IF NOT EXISTS mart_product_suggestions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  phone              TEXT,
  name               TEXT,
  suggested_product  TEXT NOT NULL,
  detail             TEXT,
  zone_id            TEXT,
  zone_name          TEXT,
  store_id           UUID REFERENCES mart_stores(id) ON DELETE SET NULL,
  store_name         TEXT,
  buyer_type         TEXT NOT NULL DEFAULT 'new' CHECK (buyer_type IN ('new', 'repeat')),
  order_count        INT NOT NULL DEFAULT 0,
  contact_consent    BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'added', 'declined')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_suggestions_created
  ON mart_product_suggestions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_suggestions_zone
  ON mart_product_suggestions(zone_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_suggestions_status
  ON mart_product_suggestions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_suggestions_buyer
  ON mart_product_suggestions(buyer_type, created_at DESC);
