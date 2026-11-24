ALTER TABLE mart_referral_campaigns
  ADD COLUMN IF NOT EXISTS redemption_min_order_amount NUMERIC(10,2);

ALTER TABLE mart_referrals
  ADD COLUMN IF NOT EXISTS redemption_min_order_amount NUMERIC(10,2);

ALTER TABLE mart_referral_credits
  ADD COLUMN IF NOT EXISTS redemption_min_order_amount NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mart_referral_campaigns_redemption_min_non_negative' AND conrelid = 'mart_referral_campaigns'::regclass) THEN
    ALTER TABLE mart_referral_campaigns
      ADD CONSTRAINT mart_referral_campaigns_redemption_min_non_negative
      CHECK (redemption_min_order_amount IS NULL OR redemption_min_order_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mart_referrals_redemption_min_non_negative' AND conrelid = 'mart_referrals'::regclass) THEN
    ALTER TABLE mart_referrals
      ADD CONSTRAINT mart_referrals_redemption_min_non_negative
      CHECK (redemption_min_order_amount IS NULL OR redemption_min_order_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mart_referral_credits_redemption_min_non_negative' AND conrelid = 'mart_referral_credits'::regclass) THEN
    ALTER TABLE mart_referral_credits
      ADD CONSTRAINT mart_referral_credits_redemption_min_non_negative
      CHECK (redemption_min_order_amount IS NULL OR redemption_min_order_amount >= 0);
  END IF;
END $$;

UPDATE mart_referral_campaigns c
   SET redemption_min_order_amount = configured.amount
  FROM (
    SELECT NULLIF(value, '')::numeric AS amount
      FROM mart_settings
     WHERE key IN ('referral_min_order_amount', 'min_order_amount')
       AND NULLIF(value, '')::numeric IS NOT NULL
     ORDER BY CASE key WHEN 'referral_min_order_amount' THEN 0 ELSE 1 END, store_id
     LIMIT 1
  ) configured
 WHERE c.redemption_min_order_amount IS NULL;

UPDATE mart_referrals r
   SET redemption_min_order_amount = c.redemption_min_order_amount
  FROM mart_referral_campaigns c
 WHERE r.campaign_id = c.id
   AND r.redemption_min_order_amount IS NULL;

UPDATE mart_referral_credits cr
   SET redemption_min_order_amount = COALESCE(r.redemption_min_order_amount, c.redemption_min_order_amount)
  FROM mart_referrals r
  LEFT JOIN mart_referral_campaigns c ON c.id = r.campaign_id
 WHERE cr.referral_id = r.id
   AND cr.redemption_min_order_amount IS NULL;

UPDATE mart_referral_credits cr
   SET redemption_min_order_amount = c.redemption_min_order_amount
  FROM mart_referral_campaigns c
 WHERE cr.campaign_id = c.id
   AND cr.redemption_min_order_amount IS NULL;

UPDATE mart_referral_credits
   SET redemption_min_order_amount = NULL
 WHERE benefit_type = 'first_order';
