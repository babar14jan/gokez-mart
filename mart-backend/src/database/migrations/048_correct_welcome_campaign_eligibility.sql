-- Preserve the first-order intent of campaigns created before eligibility_type.
UPDATE mart_campaigns
SET eligibility_type = 'first_order',
    updated_at = NOW()
WHERE new_customers_only = true
  AND eligibility_type = 'all';

-- FIRST50 is a welcome code and must never operate as a repeat-use offer.
UPDATE mart_campaigns
SET eligibility_type = 'first_order',
    new_customers_only = true,
    per_customer_limit = 1,
    updated_at = NOW()
WHERE UPPER(coupon_code) = 'FIRST50'
  AND (
    eligibility_type <> 'first_order'
    OR new_customers_only <> true
    OR per_customer_limit <> 1
  );