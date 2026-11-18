ALTER TABLE mart_referral_credits
  ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'reward'
    CHECK (benefit_type IN ('first_order', 'reward'));

ALTER TABLE mart_referrals
  ADD COLUMN IF NOT EXISTS first_order_credit_id UUID REFERENCES mart_referral_credits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referral_credits_benefit
  ON mart_referral_credits(referral_id, benefit_type);
