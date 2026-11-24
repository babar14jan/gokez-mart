UPDATE mart_orders
   SET total = GREATEST(0, CEIL(subtotal + delivery_charge - campaign_discount - COALESCE(referral_discount, 0)))::numeric(10,2)
 WHERE campaign_discount = floor(campaign_discount)
   AND total <> GREATEST(0, CEIL(subtotal + delivery_charge - campaign_discount - COALESCE(referral_discount, 0)))::numeric(10,2);
