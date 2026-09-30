-- Phase 3 server-side cart.
--
-- The customer cart in mart-user is Zustand persisted to localStorage, which
-- means it disappears with the tab and leaves no server-side record. That makes
-- "added to cart but never ordered" unmeasurable, because the only evidence
-- ever lived in the customer's browser.
--
-- This table is an ADDITIVE durable record. localStorage stays the render
-- source so checkout behaviour is untouched; this is the analytics mirror that
-- makes the cart funnel measurable, and it also lets a cart be recovered on a
-- different device once the customer verifies their number.
--
-- `items` is a JSONB snapshot of CartItem, matching the shape in
-- mart-user/src/store/cartStore.ts. Kept denormalised on purpose: a cart is a
-- short-lived aggregate, it is never queried by individual product, and one
-- row per active cart keeps the write path to a single upsert.

CREATE TABLE IF NOT EXISTS mart_carts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A cart belongs to a verified customer when one is known, and otherwise to
  -- the anonymous session that created it.
  customer_id     UUID REFERENCES mart_customers(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count      INTEGER NOT NULL DEFAULT 0,
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Highest stage the cart reached, so "started checkout but never ordered"
  -- is a single indexed comparison rather than an event scan.
  reached_checkout BOOLEAN NOT NULL DEFAULT false,
  converted_at    TIMESTAMPTZ,
  -- The order that converted this cart. Without it a "converted" row is an
  -- unverifiable assertion; with it, every conversion in the funnel panel can
  -- be joined back to a real order and its revenue. Set in the same statement
  -- as converted_at so the two can never disagree.
  order_id        UUID REFERENCES mart_orders(id) ON DELETE SET NULL,
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversion is queried by order (to reconcile the funnel against real sales)
-- and must never point at a deleted order.
CREATE INDEX IF NOT EXISTS idx_carts_order_id
  ON mart_carts(order_id)
  WHERE order_id IS NOT NULL;

-- One live cart per session, and one per customer. Both are partial unique
-- indexes so a NULL side does not collide across anonymous sessions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_session_unique
  ON mart_carts(session_id)
  WHERE converted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_customer_unique
  ON mart_carts(customer_id)
  WHERE customer_id IS NOT NULL AND converted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_carts_last_active
  ON mart_carts(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_carts_reached_checkout
  ON mart_carts(reached_checkout, converted_at)
  WHERE converted_at IS NULL;
