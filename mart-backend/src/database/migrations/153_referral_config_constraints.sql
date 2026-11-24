UPDATE mart_referral_campaigns
   SET max_referrals_per_referrer = 10
 WHERE max_referrals_per_referrer IS NULL OR max_referrals_per_referrer < 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mart_referral_campaigns_cap_positive'
       AND conrelid = 'mart_referral_campaigns'::regclass
  ) THEN
    ALTER TABLE mart_referral_campaigns
      ADD CONSTRAINT mart_referral_campaigns_cap_positive
      CHECK (max_referrals_per_referrer >= 1);
  END IF;
END $$;

UPDATE mart_referral_campaigns
   SET expiry_days = NULL
 WHERE expiry_days IS NOT NULL AND expiry_days <= 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mart_referral_campaigns_expiry_positive'
       AND conrelid = 'mart_referral_campaigns'::regclass
  ) THEN
    ALTER TABLE mart_referral_campaigns
      ADD CONSTRAINT mart_referral_campaigns_expiry_positive
      CHECK (expiry_days IS NULL OR expiry_days > 0);
  END IF;
END $$;
