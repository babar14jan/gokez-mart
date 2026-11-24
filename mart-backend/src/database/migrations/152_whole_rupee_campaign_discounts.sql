WITH changed AS (
  SELECT id, campaign_discount - floor(campaign_discount) AS restored
    FROM mart_orders
   WHERE campaign_discount <> floor(campaign_discount)
)
UPDATE mart_referrals r
   SET qualifying_order_value = GREATEST(0, r.qualifying_order_value + c.restored)
  FROM changed c
 WHERE r.qualifying_order_id = c.id
   AND r.qualifying_order_value IS NOT NULL;

UPDATE mart_orders
   SET total = GREATEST(0, CEIL(subtotal + delivery_charge - floor(campaign_discount) - COALESCE(referral_discount, 0)))::numeric(10,2),
       campaign_discount = floor(campaign_discount)
 WHERE campaign_discount <> floor(campaign_discount);

UPDATE mart_campaign_uses
   SET discount_applied = floor(discount_applied)
 WHERE discount_applied <> floor(discount_applied);

ALTER TABLE mart_orders
  DROP CONSTRAINT IF EXISTS mart_orders_campaign_discount_whole_rupees,
  ADD CONSTRAINT mart_orders_campaign_discount_whole_rupees
    CHECK (campaign_discount = floor(campaign_discount));

ALTER TABLE mart_campaign_uses
  DROP CONSTRAINT IF EXISTS mart_campaign_uses_discount_applied_whole_rupees,
  ADD CONSTRAINT mart_campaign_uses_discount_applied_whole_rupees
    CHECK (discount_applied = floor(discount_applied));
