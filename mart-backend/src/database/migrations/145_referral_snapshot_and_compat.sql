ALTER TABLE mart_referral_campaigns
  ALTER COLUMN reward_stages SET DEFAULT '[{"stage":1,"amount":25.00},{"stage":2,"amount":25.00}]'::jsonb;

ALTER TABLE mart_referrals
  ADD COLUMN IF NOT EXISTS reward_stages JSONB,
  ADD COLUMN IF NOT EXISTS total_reward_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS campaign_version INT;

UPDATE mart_referrals r
   SET reward_stages = COALESCE(c.reward_stages, '[{"stage":1,"amount":25.00},{"stage":2,"amount":25.00}]'::jsonb),
       total_reward_amount = COALESCE(c.total_reward_amount, 50.00),
       campaign_version = COALESCE(c.version, 1)
  FROM mart_referral_campaigns c
 WHERE r.campaign_id = c.id
   AND (r.reward_stages IS NULL OR r.total_reward_amount IS NULL OR r.campaign_version IS NULL);

UPDATE mart_referrals
   SET reward_stages = '[{"stage":1,"amount":25.00},{"stage":2,"amount":25.00}]'::jsonb
 WHERE reward_stages IS NULL;

UPDATE mart_referrals
   SET total_reward_amount = 50.00
 WHERE total_reward_amount IS NULL;

UPDATE mart_referrals
   SET campaign_version = 1
 WHERE campaign_version IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_first_order_credit
  ON mart_referral_credits(referral_id)
 WHERE benefit_type = 'first_order' AND referral_id IS NOT NULL;

DO $$
DECLARE
  referral_row RECORD;
  first_stage_amount NUMERIC(10,2);
  credit_id UUID;
BEGIN
  FOR referral_row IN
    SELECT id, reward_stages, campaign_id, campaign_version
      FROM mart_referrals
     WHERE first_order_credit_id IS NULL
       AND status IN ('pending', 'qualified')
       AND qualifying_order_id IS NULL
  LOOP
    first_stage_amount := COALESCE((
      SELECT (entry->>'amount')::numeric
        FROM jsonb_array_elements(referral_row.reward_stages) AS entry
       WHERE (entry->>'stage')::int = 1
       LIMIT 1
    ), 25.00);

    SELECT c.id INTO credit_id
      FROM mart_referral_credits c
     WHERE c.referral_id = referral_row.id
       AND c.benefit_type = 'reward'
       AND c.status IN ('available', 'reserved')
       AND c.order_id IS NULL
     ORDER BY c.created_at ASC
     LIMIT 1;

    IF credit_id IS NULL THEN
      INSERT INTO mart_referral_credits
        (id, benefit_type, referral_id, customer_id, campaign_id, campaign_version,
         amount, stage_number, status, unlocked_at, expires_at)
      SELECT gen_random_uuid(), 'first_order', r.id, r.referred_customer_id, r.campaign_id,
             COALESCE(r.campaign_version, 1), first_stage_amount, 1, 'available', NOW(),
             CASE WHEN c.expiry_days IS NULL THEN NULL ELSE NOW() + (c.expiry_days || ' days')::interval END
        FROM mart_referrals r
        LEFT JOIN mart_referral_campaigns c ON c.id = r.campaign_id
       WHERE r.id = referral_row.id
      RETURNING id INTO credit_id;
    ELSE
      UPDATE mart_referral_credits
         SET benefit_type = 'first_order',
             stage_number = 1,
             amount = first_stage_amount,
             updated_at = NOW()
       WHERE id = credit_id;
    END IF;

    UPDATE mart_referrals
       SET first_order_credit_id = credit_id,
           updated_at = NOW()
     WHERE id = referral_row.id;
  END LOOP;
END $$;

INSERT INTO mart_settings (key, value, label, store_id, updated_at)
SELECT 'referral_min_order_amount', '199', 'Referral Minimum Order Amount', s.id, NOW()
  FROM mart_stores s
ON CONFLICT (store_id, key) DO NOTHING;
