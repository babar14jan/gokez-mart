-- Migration 037: Customer Feedback

CREATE TABLE IF NOT EXISTS mart_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  store_id    UUID REFERENCES mart_stores(id) ON DELETE SET NULL,
  order_id    UUID REFERENCES mart_orders(id) ON DELETE SET NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  category    TEXT NOT NULL CHECK (category IN ('delivery', 'product_quality', 'pricing', 'app_experience', 'store_service', 'suggestion', 'other')),
  message     TEXT,
  customer_name  TEXT,
  customer_phone TEXT,
  store_name     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_store    ON mart_feedback(store_id);
CREATE INDEX IF NOT EXISTS idx_feedback_customer ON mart_feedback(customer_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating   ON mart_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_created  ON mart_feedback(created_at DESC);
