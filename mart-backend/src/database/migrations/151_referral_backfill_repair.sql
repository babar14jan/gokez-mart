DO $$
DECLARE
  credit_row RECORD;
  reward_row RECORD;
  first_stage INT;
  minimum_amount NUMERIC(10,2);
BEGIN
  FOR credit_row IN
    SELECT c.*,
           ref.id AS referral_id,
           ref.referred_customer_id AS referral_customer_id,
           ref.redemption_min_order_amount AS referral_minimum,
           ref.qualifying_order_id
      FROM mart_referral_credits c
      JOIN mart_referrals ref ON ref.id = c.referral_id
     WHERE c.benefit_type = 'first_order'
       AND c.status = 'expired'
       AND ref.status = 'rewarded'
       AND ref.first_order_credit_id = c.id
  LOOP
    SELECT rw.id AS reward_id, rw.reward_stages
      INTO reward_row
      FROM mart_referral_rewards rw
     WHERE rw.referral_id = credit_row.referral_id
       AND rw.role = 'referee';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT MIN((stage->>'stage')::int)
      INTO first_stage
      FROM jsonb_array_elements(COALESCE(reward_row.reward_stages, '[{"stage":1,"amount":0}]'::jsonb)) AS stage;

    minimum_amount := COALESCE(
      credit_row.referral_minimum,
      (SELECT c.redemption_min_order_amount FROM mart_referral_campaigns c WHERE c.id = credit_row.campaign_id),
      (SELECT NULLIF(value, '')::numeric FROM mart_settings WHERE key = 'referral_min_order_amount' LIMIT 1),
      (SELECT NULLIF(value, '')::numeric FROM mart_settings WHERE key = 'min_order_amount' LIMIT 1),
      0
    );

    UPDATE mart_referral_credits c
       SET benefit_type = 'reward',
           reward_id = reward_row.id,
           stage_number = COALESCE(first_stage, 1),
           redemption_min_order_amount = minimum_amount,
           unlocked_at = COALESCE(c.unlocked_at, NOW()),
           expires_at = NULL,
           status = 'available',
           reserved_at = NULL,
           reservation_expires_at = NULL,
           redeemed_at = NULL,
           order_id = NULL,
           updated_at = NOW()
     WHERE c.id = credit_row.id
       AND c.status = 'expired'
       AND NOT EXISTS (
         SELECT 1 FROM mart_referral_credits sibling
          WHERE sibling.reward_id = reward_row.id
            AND sibling.stage_number = COALESCE(first_stage, 1)
       );

    IF FOUND THEN
      INSERT INTO mart_referral_transactions
        (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type,
         amount, balance_after, reason, idempotency_key)
      VALUES
         (gen_random_uuid(), 'TXN-ADMIN_ADJUST-' || gen_random_uuid()::text, credit_row.id, reward_row.id,
          credit_row.referral_id, credit_row.customer_id, credit_row.qualifying_order_id, 'admin_adjust',
          COALESCE(credit_row.amount, 0),
          COALESCE((SELECT SUM(amount) FROM mart_referral_credits
                     WHERE customer_id = credit_row.customer_id AND status IN ('available', 'reserved')), 0),
          'Expired first-order discount restored as stage 1 reward',
          'BACKFILL-RESTORE-EXPIRED-FIRST-ORDER:' || credit_row.referral_id::text || ':' || credit_row.id::text)
      ON CONFLICT (idempotency_key) DO NOTHING;

      INSERT INTO mart_referral_audit_logs
        (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
      VALUES
        (gen_random_uuid(), 'referral_credit', credit_row.id::text, 'first_order_credit_restored_after_expiry',
         credit_row.customer_id,
         jsonb_build_object('benefitType', 'first_order', 'status', 'expired'),
         jsonb_build_object('benefitType', 'reward', 'status', 'available', 'rewardId', reward_row.id),
         'Expired first-order discount was restored so later stages stay reachable');
    END IF;
  END LOOP;

  FOR credit_row IN
    SELECT c.id, ref.id AS referral_id, ref.referred_customer_id AS customer_id, rw.id AS reward_id, rw.reward_stages
      FROM mart_referral_credits c
      JOIN mart_referrals ref ON ref.id = c.referral_id
      JOIN mart_referral_rewards rw ON rw.referral_id = ref.id AND rw.role = 'referee'
     WHERE c.benefit_type = 'first_order'
       AND c.status = 'redeemed'
       AND ref.status = 'rewarded'
       AND (c.reward_id IS NULL OR c.stage_number IS NULL)
  LOOP
    SELECT MIN((stage->>'stage')::int)
      INTO first_stage
      FROM jsonb_array_elements(COALESCE(credit_row.reward_stages, '[{"stage":1,"amount":0}]'::jsonb)) AS stage;

    UPDATE mart_referral_credits c
       SET reward_id = credit_row.reward_id,
           stage_number = COALESCE(first_stage, 1),
           updated_at = NOW()
     WHERE c.id = credit_row.id
       AND c.benefit_type = 'first_order'
       AND c.status = 'redeemed';

    IF FOUND THEN
      INSERT INTO mart_referral_audit_logs
        (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
      VALUES
        (gen_random_uuid(), 'referral_credit', credit_row.id::text, 'first_order_credit_linked_after_backfill',
         credit_row.customer_id,
         jsonb_build_object('rewardId', NULL, 'stageNumber', NULL),
         jsonb_build_object('rewardId', credit_row.reward_id, 'stageNumber', COALESCE(first_stage, 1)),
         'Used first-order discount linked to the referee reward');
    END IF;
  END LOOP;

  UPDATE mart_referral_campaigns
     SET expiry_days = NULL, updated_at = NOW()
   WHERE expiry_days = 0;
END $$;
