-- Migration 140: Referral & Earn
-- Referral codes, attribution, delivered-order reward release, redeemable
-- credits and a fully attributable ledger. All money stays NUMERIC(10,2).

CREATE TABLE IF NOT EXISTS mart_referral_campaigns (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version                     INT NOT NULL DEFAULT 1,
  name                        TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  referrer_reward             NUMERIC(10,2) NOT NULL DEFAULT 100.00,
  referee_reward              NUMERIC(10,2) NOT NULL DEFAULT 100.00,
  credit_amount               NUMERIC(10,2) NOT NULL DEFAULT 20.00,
  credits_per_reward          INT NOT NULL DEFAULT 5,
  qualifying_order_min        NUMERIC(10,2) NOT NULL DEFAULT 149.00,
  redemption_min              NUMERIC(10,2) NOT NULL DEFAULT 99.00,
  expiry_days                 INT DEFAULT 90, -- NULL means never expires
  max_referrals_per_referrer  INT NOT NULL DEFAULT 10,
  stacking_enabled            BOOLEAN NOT NULL DEFAULT false,
  unlock_trigger              TEXT NOT NULL DEFAULT 'delivered',
  cash_withdrawal             BOOLEAN NOT NULL DEFAULT false,
  transfer_enabled            BOOLEAN NOT NULL DEFAULT false,
  starts_at                   TIMESTAMPTZ,
  ends_at                     TIMESTAMPTZ,
  budget                      NUMERIC(10,2),
  code_length                 INT NOT NULL DEFAULT 6,
  fraud_review_enabled        BOOLEAN NOT NULL DEFAULT false,
  value_basis                 TEXT NOT NULL DEFAULT 'item_subtotal'
                              CHECK (value_basis IN ('item_subtotal', 'grand_total')),
  category_ids                UUID[] NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  reason                      TEXT
);

CREATE TABLE IF NOT EXISTS mart_referral_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL UNIQUE REFERENCES mart_customers(id) ON DELETE CASCADE,
  code           TEXT NOT NULL UNIQUE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  regenerated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mart_referrals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id                UUID REFERENCES mart_referral_codes(id) ON DELETE SET NULL,
  referrer_customer_id   UUID NOT NULL REFERENCES mart_customers(id),
  referred_customer_id   UUID NOT NULL UNIQUE REFERENCES mart_customers(id),
  campaign_id            UUID REFERENCES mart_referral_campaigns(id),
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'qualified', 'rewarded', 'capped', 'rejected', 'expired')),
  attribution_source     TEXT NOT NULL DEFAULT 'link'
                         CHECK (attribution_source IN ('registration', 'account', 'checkout', 'link')),
  qualifying_order_id    UUID UNIQUE REFERENCES mart_orders(id),
  qualifying_order_value NUMERIC(10,2),
  attributed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qualified_at           TIMESTAMPTZ,
  rewarded_at            TIMESTAMPTZ,
  rejected_at            TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (referrer_customer_id <> referred_customer_id)
);

CREATE TABLE IF NOT EXISTS mart_referral_rewards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id     UUID NOT NULL REFERENCES mart_referrals(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES mart_customers(id),
  role            TEXT NOT NULL CHECK (role IN ('referrer', 'referee')),
  campaign_id     UUID REFERENCES mart_referral_campaigns(id),
  campaign_version INT NOT NULL DEFAULT 1,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status          TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'reversed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referral_id, role)
);

CREATE TABLE IF NOT EXISTS mart_referral_credits (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id              UUID REFERENCES mart_referral_rewards(id) ON DELETE SET NULL,
  referral_id            UUID REFERENCES mart_referrals(id) ON DELETE SET NULL,
  customer_id            UUID NOT NULL REFERENCES mart_customers(id),
  campaign_id            UUID REFERENCES mart_referral_campaigns(id),
  campaign_version       INT NOT NULL DEFAULT 1,
  amount                 NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status                 TEXT NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available', 'reserved', 'redeemed', 'expired', 'reversed')),
  unlocked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at             TIMESTAMPTZ, -- NULL means never expires
  reserved_at            TIMESTAMPTZ,
  reservation_expires_at TIMESTAMPTZ,
  redeemed_at            TIMESTAMPTZ,
  order_id               UUID UNIQUE REFERENCES mart_orders(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mart_referral_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE,
  credit_id        UUID REFERENCES mart_referral_credits(id) ON DELETE SET NULL,
  reward_id        UUID REFERENCES mart_referral_rewards(id) ON DELETE SET NULL,
  referral_id      UUID REFERENCES mart_referrals(id) ON DELETE SET NULL,
  customer_id      UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  order_id         UUID REFERENCES mart_orders(id) ON DELETE SET NULL,
  type             TEXT NOT NULL CHECK (type IN ('issue', 'reserve', 'restore', 'redeem', 'expire', 'reverse', 'admin_adjust')),
  amount           NUMERIC(10,2) NOT NULL,
  balance_after    NUMERIC(10,2) NOT NULL CHECK (balance_after >= 0),
  reason           TEXT,
  actor_admin_id   UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mart_referral_audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL,
  entity_id         TEXT,
  action            TEXT NOT NULL,
  actor_admin_id    UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  actor_customer_id UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  before            JSONB,
  after             JSONB,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS referral_credit_id UUID REFERENCES mart_referral_credits(id);
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS referral_discount NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_referral_campaigns_status_window
  ON mart_referral_campaigns(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_referral_codes_active ON mart_referral_codes(code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status ON mart_referrals(referrer_customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_status_attributed ON mart_referrals(status, attributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_campaign ON mart_referrals(campaign_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_customer ON mart_referral_rewards(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_credits_customer_status ON mart_referral_credits(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_credits_expires
  ON mart_referral_credits(expires_at) WHERE status IN ('available', 'reserved');
CREATE INDEX IF NOT EXISTS idx_referral_credits_reservation
  ON mart_referral_credits(reservation_expires_at) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_referral_transactions_customer
  ON mart_referral_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_transactions_order ON mart_referral_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_referral_audit_entity
  ON mart_referral_audit_logs(entity_type, entity_id, created_at DESC);

-- The system always has one campaign to attribute against. Admins may create,
-- pause and supersede it; the defaults here are the approved business defaults.
INSERT INTO mart_referral_campaigns (name, status)
SELECT 'Referral & Earn', 'active'
WHERE NOT EXISTS (SELECT 1 FROM mart_referral_campaigns);

-- Backfill one code per pre-existing customer. The base expression is the repo's
-- deterministic-safe UUID slice; ambiguous characters are discarded and unique
-- violations retried so the UNIQUE constraint always wins.
DO $$
DECLARE
  customer_row RECORD;
  candidate_code TEXT;
  attempt INTEGER;
  inserted BOOLEAN;
BEGIN
  FOR customer_row IN
    SELECT c.id FROM mart_customers c
    WHERE NOT EXISTS (SELECT 1 FROM mart_referral_codes rc WHERE rc.customer_id = c.id)
  LOOP
    attempt := 0;
    inserted := false;
    WHILE NOT inserted AND attempt < 100 LOOP
      attempt := attempt + 1;
      candidate_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      CONTINUE WHEN candidate_code ~ '[01OI]';
      BEGIN
        INSERT INTO mart_referral_codes (id, customer_id, code)
        VALUES (gen_random_uuid(), customer_row.id, candidate_code);
        inserted := true;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END LOOP;
END $$;
