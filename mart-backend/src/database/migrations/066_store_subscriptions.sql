-- Store subscriptions are separate from customer order payments and preserve a
-- history of the platform access periods configured by a super administrator.
CREATE TABLE IF NOT EXISTS mart_store_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  plan_name         TEXT NOT NULL DEFAULT 'Standard',
  amount            NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'suspended', 'expired', 'cancelled')),
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  payment_reference TEXT,
  notes             TEXT,
  created_by        UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_mart_store_subscriptions_store ON mart_store_subscriptions(store_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_store_subscriptions_one_active
  ON mart_store_subscriptions(store_id) WHERE status = 'active';

-- Preserve the existing production store as already enrolled for three years.
-- This inserts a related subscription record only; no existing store fields are changed.
INSERT INTO mart_store_subscriptions
  (store_id, plan_name, amount, status, starts_at, ends_at, notes)
SELECT id, 'Legacy three-year subscription', monthly_fee, 'active', created_at,
       created_at + INTERVAL '3 years', 'Existing store subscription preserved during subscription rollout'
FROM mart_stores
WHERE id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (store_id) WHERE status = 'active' DO NOTHING;