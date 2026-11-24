DO $$
DECLARE
  ref_row RECORD;
  ord_row RECORD;
  st RECORD;
  v_stages JSONB;
  v_total NUMERIC(10,2);
  v_min NUMERIC(10,2);
  v_version INT;
  v_unlocked_at TIMESTAMPTZ := NOW();
  v_expires_at TIMESTAMPTZ;
  v_value NUMERIC(10,2);
  v_role TEXT;
  v_customer UUID;
  v_reward_id UUID;
  v_credit_id UUID;
  v_cap INT;
  v_first_stage INT;
  v_first_order_credit_id UUID;
  v_first_order_status TEXT;
  v_first_order_amount NUMERIC(10,2);
  v_first_order_used BOOLEAN := false;
BEGIN
  FOR ref_row IN
    SELECT ref.*,
           c.expiry_days AS source_campaign_expiry_days,
           c.category_ids AS source_campaign_category_ids,
           c.value_basis AS source_campaign_value_basis,
           c.max_referrals_per_referrer AS source_campaign_cap,
           c.redemption_min_order_amount AS source_campaign_min,
           c.reward_stages AS source_campaign_stages,
           c.total_reward_amount AS source_campaign_total,
           c.version AS source_campaign_version
      FROM mart_referrals ref
      LEFT JOIN mart_referral_campaigns c ON c.id = ref.campaign_id
     WHERE ref.status IN ('pending', 'qualified')
       AND ref.qualifying_order_id IS NULL
  LOOP
    SELECT ord.id,
           ord.subtotal::numeric AS subtotal,
           ord.campaign_discount::numeric AS campaign_discount,
           ord.delivery_charge::numeric AS delivery_charge,
           ord.referral_credit_id
      INTO ord_row
      FROM mart_orders ord
     WHERE ord.customer_id = ref_row.referred_customer_id
       AND ord.status = 'delivered'
       AND COALESCE(ord.delivered_at, ord.created_at) >= ref_row.attributed_at
     ORDER BY COALESCE(ord.delivered_at, ord.created_at), ord.created_at
     LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_stages := COALESCE(ref_row.reward_stages, ref_row.source_campaign_stages);
    v_total := COALESCE(ref_row.total_reward_amount, ref_row.source_campaign_total);
    IF v_stages IS NULL OR jsonb_typeof(v_stages) <> 'array' OR jsonb_array_length(v_stages) = 0 OR v_total IS NULL THEN
      CONTINUE;
    END IF;

    v_min := COALESCE(
      ref_row.redemption_min_order_amount,
      ref_row.source_campaign_min,
      (SELECT NULLIF(value, '')::numeric
         FROM mart_settings
        WHERE key IN ('referral_min_order_amount', 'min_order_amount')
          AND NULLIF(value, '')::numeric IS NOT NULL
        ORDER BY CASE key WHEN 'referral_min_order_amount' THEN 0 ELSE 1 END, store_id
        LIMIT 1)
    );
    v_version := COALESCE(ref_row.campaign_version, ref_row.source_campaign_version, 1);
    v_expires_at := CASE
      WHEN ref_row.source_campaign_expiry_days IS NULL OR ref_row.source_campaign_expiry_days <= 0 THEN NULL
      ELSE v_unlocked_at + (ref_row.source_campaign_expiry_days || ' days')::interval
    END;
    v_value := GREATEST(
      0::numeric,
      CASE
        WHEN COALESCE(ref_row.source_campaign_value_basis, 'item_subtotal') = 'grand_total'
          THEN ord_row.subtotal - floor(ord_row.campaign_discount) + ord_row.delivery_charge
        ELSE ord_row.subtotal - floor(ord_row.campaign_discount)
      END
    );

    v_cap := COALESCE(ref_row.source_campaign_cap, 0);
    IF v_cap > 0 AND (
      SELECT COUNT(*)::int
        FROM mart_referral_rewards rw
        JOIN mart_referrals rr ON rr.id = rw.referral_id
       WHERE rr.referrer_customer_id = ref_row.referrer_customer_id
         AND rw.role = 'referrer'
         AND rw.status = 'issued'
    ) >= v_cap THEN
      UPDATE mart_referrals
         SET status = 'capped',
             notes = COALESCE(notes, '') || ' Backfill capped: referrer campaign reward limit already reached.',
             updated_at = NOW()
       WHERE id = ref_row.id;
      INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
      VALUES (gen_random_uuid(), 'referral', ref_row.id::text, 'backfill_unlock_capped', ref_row.referred_customer_id,
              jsonb_build_object('status', ref_row.status), jsonb_build_object('status', 'capped'),
              'Referrer campaign reward limit already reached during backfill.');
      CONTINUE;
    END IF;

    v_first_order_credit_id := ref_row.first_order_credit_id;
    v_first_order_status := NULL;
    v_first_order_amount := NULL;
    v_first_order_used := false;
    IF v_first_order_credit_id IS NOT NULL THEN
      SELECT status, amount INTO v_first_order_status, v_first_order_amount
        FROM mart_referral_credits
       WHERE id = v_first_order_credit_id;
      v_first_order_used := COALESCE(v_first_order_status = 'redeemed', false);

      IF v_first_order_status = 'reserved' AND ord_row.referral_credit_id = v_first_order_credit_id THEN
        UPDATE mart_referral_credits
           SET status = 'redeemed',
               redeemed_at = v_unlocked_at,
               order_id = ord_row.id,
               updated_at = NOW()
         WHERE id = v_first_order_credit_id
           AND status = 'reserved'
         RETURNING id INTO v_credit_id;
        IF FOUND THEN
          v_first_order_status := 'redeemed';
          v_first_order_used := true;
          INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
          VALUES (gen_random_uuid(), 'BACKFILL-REDEEM-FIRST-' || v_credit_id::text, v_credit_id, NULL, ref_row.id,
                  ref_row.referred_customer_id, ord_row.id, 'redeem', v_first_order_amount,
                  COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = ref_row.referred_customer_id AND status IN ('available', 'reserved')), 0),
                  'First-order referral credit consumed by delivered order during backfill.',
                  'BACKFILL-REDEEM-FIRST-' || v_credit_id::text);
          INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
          VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_first_order_redeemed', ref_row.referred_customer_id,
                  jsonb_build_object('status', 'reserved'), jsonb_build_object('status', 'redeemed', 'order_id', ord_row.id),
                  'Delivered order used the reserved first-order referral credit.');
        END IF;
      END IF;
    END IF;

    SELECT (entry->>'stage')::int INTO v_first_stage
      FROM jsonb_array_elements(v_stages) AS entry
     ORDER BY (entry->>'stage')::int
     LIMIT 1;

    FOREACH v_role IN ARRAY ARRAY['referrer', 'referee']::text[]
    LOOP
      v_customer := CASE WHEN v_role = 'referrer' THEN ref_row.referrer_customer_id ELSE ref_row.referred_customer_id END;
      v_reward_id := NULL;

      INSERT INTO mart_referral_rewards (id, referral_id, customer_id, role, campaign_id, campaign_version, amount, status, reward_stages)
      VALUES (gen_random_uuid(), ref_row.id, v_customer, v_role, ref_row.campaign_id, v_version, v_total, 'issued', v_stages)
      ON CONFLICT (referral_id, role) DO NOTHING
      RETURNING id INTO v_reward_id;

      IF v_reward_id IS NULL THEN
        SELECT id INTO v_reward_id
          FROM mart_referral_rewards
         WHERE referral_id = ref_row.id
           AND role = v_role
           AND status = 'issued';
      END IF;
      IF v_reward_id IS NULL THEN
        CONTINUE;
      END IF;

      FOR st IN
        SELECT (entry->>'stage')::int AS stage,
               (entry->>'amount')::numeric AS amount
          FROM jsonb_array_elements(v_stages) AS entry
         ORDER BY (entry->>'stage')::int
      LOOP
        IF v_role = 'referee' AND st.stage = v_first_stage AND v_first_order_credit_id IS NOT NULL THEN
          IF v_first_order_status IN ('expired', 'reversed') THEN
            CONTINUE;
          END IF;

          IF v_first_order_used THEN
            CONTINUE;
          END IF;

          IF v_first_order_status IN ('available', 'reserved')
             AND EXISTS (SELECT 1 FROM mart_referral_credits WHERE reward_id = v_reward_id AND stage_number = st.stage) THEN
            UPDATE mart_referral_credits
               SET status = 'reversed',
                   updated_at = NOW()
             WHERE id = v_first_order_credit_id
               AND benefit_type = 'first_order'
               AND status IN ('available', 'reserved')
             RETURNING id INTO v_credit_id;
            IF FOUND THEN
              INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
              VALUES (gen_random_uuid(), 'BACKFILL-SUPERSEDE-FIRST-' || v_credit_id::text, v_credit_id, v_reward_id, ref_row.id,
                      ref_row.referred_customer_id, NULL, 'reverse', v_first_order_amount,
                      COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = ref_row.referred_customer_id AND status IN ('available', 'reserved')), 0),
                      'First-order credit superseded by an identical issued stage-one reward during backfill.',
                      'BACKFILL-SUPERSEDE-FIRST-' || v_credit_id::text);
              INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
              VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_first_order_superseded', ref_row.referred_customer_id,
                      jsonb_build_object('status', v_first_order_status, 'benefit_type', 'first_order'),
                      jsonb_build_object('status', 'reversed'),
                      'Stage-one reward credit already exists; first-order credit reversed to avoid duplicate liability.');
            END IF;
            CONTINUE;
          END IF;

          UPDATE mart_referral_credits
             SET benefit_type = 'reward',
                 reward_id = v_reward_id,
                 stage_number = st.stage,
                 redemption_min_order_amount = v_min,
                 expires_at = v_expires_at,
                 unlocked_at = v_unlocked_at,
                 updated_at = NOW()
           WHERE id = v_first_order_credit_id
             AND benefit_type = 'first_order'
             AND status IN ('available', 'reserved')
             AND NOT EXISTS (
               SELECT 1 FROM mart_referral_credits WHERE reward_id = v_reward_id AND stage_number = st.stage
             )
           RETURNING id INTO v_credit_id;
          IF FOUND THEN
            INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
            VALUES (gen_random_uuid(), 'BACKFILL-CONVERT-FIRST-' || v_credit_id::text, v_credit_id, v_reward_id, ref_row.id,
                    ref_row.referred_customer_id, NULL, 'admin_adjust', 0,
                    COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = ref_row.referred_customer_id AND status IN ('available', 'reserved')), 0),
                    'Unused first-order referral credit converted into stage-one reward during backfill.',
                    'BACKFILL-CONVERT-FIRST-' || v_credit_id::text);
            INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
            VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_first_order_converted', ref_row.referred_customer_id,
                    jsonb_build_object('benefit_type', 'first_order', 'status', v_first_order_status),
                    jsonb_build_object('benefit_type', 'reward', 'reward_id', v_reward_id, 'stage_number', st.stage),
                    'Referee used another offer on the first order; first-order credit converted into stage-one reward.');
            CONTINUE;
          END IF;
        END IF;

        INSERT INTO mart_referral_credits (id, reward_id, referral_id, customer_id, campaign_id, campaign_version, benefit_type, amount, stage_number, status, unlocked_at, expires_at, redemption_min_order_amount)
        VALUES (gen_random_uuid(), v_reward_id, ref_row.id, v_customer, ref_row.campaign_id, v_version, 'reward', st.amount, st.stage, 'available', v_unlocked_at, v_expires_at, v_min)
        ON CONFLICT (reward_id, stage_number) WHERE reward_id IS NOT NULL AND stage_number IS NOT NULL DO NOTHING
        RETURNING id INTO v_credit_id;
        IF v_credit_id IS NOT NULL THEN
          INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
          VALUES (gen_random_uuid(), 'BACKFILL-ISSUE-' || v_credit_id::text, v_credit_id, v_reward_id, ref_row.id,
                  v_customer, NULL, 'issue', st.amount,
                  COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = v_customer AND status IN ('available', 'reserved')), 0),
                  'Referral reward issued by backfill after delivered-order qualification.',
                  'BACKFILL-ISSUE-' || v_credit_id::text);
          INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
          VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_reward_issued', v_customer,
                  NULL,
                  jsonb_build_object('role', v_role, 'stage', st.stage, 'amount', st.amount, 'redemption_min_order_amount', v_min),
                  'Reward unlocked by backfill under delivered-order qualification rules.');
        END IF;
      END LOOP;
    END LOOP;

    UPDATE mart_referrals
       SET status = 'rewarded',
           qualifying_order_id = ord_row.id,
           qualifying_order_value = v_value,
           qualified_at = v_unlocked_at,
           rewarded_at = v_unlocked_at,
           notes = NULL,
           updated_at = NOW()
     WHERE id = ref_row.id;
    INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
    VALUES (gen_random_uuid(), 'referral', ref_row.id::text, 'backfill_rewards_unlocked', ref_row.referred_customer_id,
            jsonb_build_object('status', ref_row.status, 'qualifying_order_id', ref_row.qualifying_order_id),
            jsonb_build_object('status', 'rewarded', 'qualifying_order_id', ord_row.id, 'qualifying_order_value', v_value),
            'Referral qualified on a delivered order under the current no-minimum unlock rules.');
  END LOOP;
END $$;

DO $$
DECLARE
  ref_row RECORD;
  rw RECORD;
  st RECORD;
  v_stages JSONB;
  v_min NUMERIC(10,2);
  v_first_stage INT;
  v_credit_id UUID;
  v_first_order_credit_id UUID;
  v_first_order_status TEXT;
  v_first_order_amount NUMERIC(10,2);
  v_first_order_used BOOLEAN;
BEGIN
  FOR ref_row IN
    SELECT ref.*,
           c.expiry_days AS source_campaign_expiry_days,
           c.redemption_min_order_amount AS source_campaign_min,
           c.reward_stages AS source_campaign_stages
      FROM mart_referrals ref
      LEFT JOIN mart_referral_campaigns c ON c.id = ref.campaign_id
     WHERE ref.status = 'rewarded'
  LOOP
    v_min := COALESCE(
      ref_row.redemption_min_order_amount,
      ref_row.source_campaign_min,
      (SELECT NULLIF(value, '')::numeric
         FROM mart_settings
        WHERE key IN ('referral_min_order_amount', 'min_order_amount')
          AND NULLIF(value, '')::numeric IS NOT NULL
        ORDER BY CASE key WHEN 'referral_min_order_amount' THEN 0 ELSE 1 END, store_id
        LIMIT 1)
    );

    v_first_order_credit_id := ref_row.first_order_credit_id;
    v_first_order_status := NULL;
    v_first_order_amount := NULL;
    v_first_order_used := false;
    IF v_first_order_credit_id IS NOT NULL THEN
      SELECT status, amount INTO v_first_order_status, v_first_order_amount
        FROM mart_referral_credits
       WHERE id = v_first_order_credit_id;
      v_first_order_used := COALESCE(v_first_order_status = 'redeemed', false);
    END IF;

    FOR rw IN
      SELECT * FROM mart_referral_rewards WHERE referral_id = ref_row.id AND status = 'issued'
    LOOP
      v_stages := COALESCE(rw.reward_stages, ref_row.reward_stages, ref_row.source_campaign_stages);
      IF v_stages IS NULL OR jsonb_typeof(v_stages) <> 'array' OR jsonb_array_length(v_stages) = 0 THEN
        CONTINUE;
      END IF;

      UPDATE mart_referral_credits
         SET redemption_min_order_amount = v_min,
             updated_at = NOW()
       WHERE reward_id = rw.id
         AND benefit_type = 'reward'
         AND redemption_min_order_amount IS DISTINCT FROM v_min;

      SELECT (entry->>'stage')::int INTO v_first_stage
        FROM jsonb_array_elements(v_stages) AS entry
       ORDER BY (entry->>'stage')::int
       LIMIT 1;

      FOR st IN
        SELECT (entry->>'stage')::int AS stage,
               (entry->>'amount')::numeric AS amount
          FROM jsonb_array_elements(v_stages) AS entry
         ORDER BY (entry->>'stage')::int
      LOOP
        IF rw.role = 'referee' AND st.stage = v_first_stage AND v_first_order_credit_id IS NOT NULL THEN
          IF v_first_order_status IN ('expired', 'reversed') OR v_first_order_used THEN
            CONTINUE;
          END IF;

          IF v_first_order_status IN ('available', 'reserved')
             AND EXISTS (SELECT 1 FROM mart_referral_credits WHERE reward_id = rw.id AND stage_number = st.stage) THEN
            UPDATE mart_referral_credits
               SET status = 'reversed',
                   updated_at = NOW()
             WHERE id = v_first_order_credit_id
               AND benefit_type = 'first_order'
               AND status IN ('available', 'reserved')
             RETURNING id INTO v_credit_id;
            IF FOUND THEN
              INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
              VALUES (gen_random_uuid(), 'BACKFILL-SUPERSEDE-FIRST-' || v_credit_id::text, v_credit_id, rw.id, ref_row.id,
                      rw.customer_id, NULL, 'reverse', v_first_order_amount,
                      COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = rw.customer_id AND status IN ('available', 'reserved')), 0),
                      'First-order credit superseded by an identical issued stage-one reward during backfill.',
                      'BACKFILL-SUPERSEDE-FIRST-' || v_credit_id::text);
              INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
              VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_first_order_superseded', rw.customer_id,
                      jsonb_build_object('status', v_first_order_status, 'benefit_type', 'first_order'),
                      jsonb_build_object('status', 'reversed'),
                      'Stage-one reward credit already exists; first-order credit reversed to avoid duplicate liability.');
            END IF;
            CONTINUE;
          END IF;

          UPDATE mart_referral_credits
             SET benefit_type = 'reward',
                 reward_id = rw.id,
                 stage_number = st.stage,
                 redemption_min_order_amount = v_min,
                  expires_at = CASE
                    WHEN ref_row.source_campaign_expiry_days IS NULL OR ref_row.source_campaign_expiry_days <= 0 THEN expires_at
                    ELSE NOW() + (ref_row.source_campaign_expiry_days || ' days')::interval
                  END,
                 updated_at = NOW()
           WHERE id = v_first_order_credit_id
             AND benefit_type = 'first_order'
             AND status IN ('available', 'reserved')
             AND NOT EXISTS (
               SELECT 1 FROM mart_referral_credits WHERE reward_id = rw.id AND stage_number = st.stage
             )
           RETURNING id INTO v_credit_id;
          IF FOUND THEN
            INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
            VALUES (gen_random_uuid(), 'BACKFILL-CONVERT-FIRST-' || v_credit_id::text, v_credit_id, rw.id, ref_row.id,
                    rw.customer_id, NULL, 'admin_adjust', 0,
                    COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = rw.customer_id AND status IN ('available', 'reserved')), 0),
                    'Unused first-order referral credit converted into stage-one reward during backfill.',
                    'BACKFILL-CONVERT-FIRST-' || v_credit_id::text);
            INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
            VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_first_order_converted', rw.customer_id,
                    jsonb_build_object('benefit_type', 'first_order', 'status', v_first_order_status),
                    jsonb_build_object('benefit_type', 'reward', 'reward_id', rw.id, 'stage_number', st.stage),
                    'Referee used another offer on the first order; first-order credit converted into stage-one reward.');
            CONTINUE;
          END IF;
        END IF;

        INSERT INTO mart_referral_credits (id, reward_id, referral_id, customer_id, campaign_id, campaign_version, benefit_type, amount, stage_number, status, unlocked_at, expires_at, redemption_min_order_amount)
        VALUES (gen_random_uuid(), rw.id, ref_row.id, rw.customer_id, ref_row.campaign_id, rw.campaign_version, 'reward', st.amount, st.stage, 'available', NOW(),
                CASE
                  WHEN ref_row.source_campaign_expiry_days IS NULL OR ref_row.source_campaign_expiry_days <= 0 THEN NULL
                  ELSE NOW() + (ref_row.source_campaign_expiry_days || ' days')::interval
                END,
                v_min)
        ON CONFLICT (reward_id, stage_number) WHERE reward_id IS NOT NULL AND stage_number IS NOT NULL DO NOTHING
        RETURNING id INTO v_credit_id;
        IF v_credit_id IS NOT NULL THEN
          INSERT INTO mart_referral_transactions (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type, amount, balance_after, reason, idempotency_key)
          VALUES (gen_random_uuid(), 'BACKFILL-ISSUE-' || v_credit_id::text, v_credit_id, rw.id, ref_row.id,
                  rw.customer_id, NULL, 'issue', st.amount,
                  COALESCE((SELECT SUM(amount) FROM mart_referral_credits WHERE customer_id = rw.customer_id AND status IN ('available', 'reserved')), 0),
                  'Missing referral stage credit restored by backfill from campaign snapshot.',
                  'BACKFILL-ISSUE-' || v_credit_id::text);
          INSERT INTO mart_referral_audit_logs (id, entity_type, entity_id, action, actor_customer_id, before, after, reason)
          VALUES (gen_random_uuid(), 'referral_credit', v_credit_id::text, 'backfill_reward_restored', rw.customer_id,
                  NULL,
                  jsonb_build_object('role', rw.role, 'stage', st.stage, 'amount', st.amount, 'redemption_min_order_amount', v_min),
                  'Missing reward stage credit restored from the stored referral or campaign snapshot.');
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
