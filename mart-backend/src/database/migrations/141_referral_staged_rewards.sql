ALTER TABLE mart_referral_campaigns
  ADD COLUMN IF NOT EXISTS total_reward_amount NUMERIC(10,2) NOT NULL DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS reward_stages JSONB NOT NULL DEFAULT '[{"stage":1,"amount":30.00},{"stage":2,"amount":20.00}]'::jsonb;

ALTER TABLE mart_referral_rewards
  ADD COLUMN IF NOT EXISTS reward_stages JSONB;

ALTER TABLE mart_referral_credits
  ADD COLUMN IF NOT EXISTS stage_number INT;

ALTER TABLE mart_referral_campaigns
  DROP COLUMN IF EXISTS qualifying_order_min,
  DROP COLUMN IF EXISTS redemption_min;

CREATE OR REPLACE FUNCTION mart_validate_referral_reward_stages()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stage_sum NUMERIC(12,2);
  stage_numbers INT[];
  expected_numbers INT[];
BEGIN
  IF jsonb_typeof(NEW.reward_stages) <> 'array' THEN
    RAISE EXCEPTION 'reward_stages must be a JSON array' USING ERRCODE = '23514';
  END IF;

  IF jsonb_array_length(NEW.reward_stages) = 0 THEN
    RAISE EXCEPTION 'reward_stages must contain at least one stage' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM((entry->>'amount')::numeric), 0),
         ARRAY_AGG((entry->>'stage')::int ORDER BY (entry->>'stage')::int)
    INTO stage_sum, stage_numbers
    FROM jsonb_array_elements(NEW.reward_stages) AS entry;

  SELECT ARRAY_AGG(generated) INTO expected_numbers
    FROM generate_series(1, jsonb_array_length(NEW.reward_stages)) AS generated;

  IF stage_numbers IS DISTINCT FROM expected_numbers THEN
    RAISE EXCEPTION 'reward_stages must be numbered sequentially from 1' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(NEW.reward_stages) AS entry
     WHERE (entry->>'amount')::numeric <= 0
        OR (entry->>'amount')::numeric <> ROUND((entry->>'amount')::numeric, 2)
  ) THEN
    RAISE EXCEPTION 'each reward stage amount must be greater than zero' USING ERRCODE = '23514';
  END IF;

  IF stage_sum IS DISTINCT FROM NEW.total_reward_amount THEN
    RAISE EXCEPTION 'reward_stages total % must equal total_reward_amount %', stage_sum, NEW.total_reward_amount
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mart_referral_reward_stages ON mart_referral_campaigns;
CREATE TRIGGER trg_mart_referral_reward_stages
  BEFORE INSERT OR UPDATE OF total_reward_amount, reward_stages
  ON mart_referral_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION mart_validate_referral_reward_stages();

CREATE UNIQUE INDEX IF NOT EXISTS uq_mart_referral_credit_stage
  ON mart_referral_credits(reward_id, stage_number)
  WHERE reward_id IS NOT NULL AND stage_number IS NOT NULL;

UPDATE mart_settings
   SET value = '199', updated_at = NOW()
 WHERE key = 'min_order_amount'
   AND value IS DISTINCT FROM '199';
