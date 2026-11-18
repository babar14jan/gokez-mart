UPDATE mart_referral_campaigns
   SET reward_stages = '[{"stage":1,"amount":25.00},{"stage":2,"amount":25.00}]'::jsonb,
       updated_at = NOW()
 WHERE total_reward_amount = 50.00
   AND reward_stages = '[{"stage":1,"amount":30.00},{"stage":2,"amount":20.00}]'::jsonb;
