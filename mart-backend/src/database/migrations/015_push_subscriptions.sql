-- Migration 015: Push notification subscriptions
CREATE TABLE IF NOT EXISTS mart_push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Either customer_id or admin_id (one must be set)
  customer_id  UUID REFERENCES mart_customers(id) ON DELETE CASCADE,
  admin_id     UUID REFERENCES mart_admins(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON mart_push_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_admin    ON mart_push_subscriptions(admin_id);
