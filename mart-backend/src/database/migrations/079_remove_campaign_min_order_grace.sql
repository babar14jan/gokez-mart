ALTER TABLE mart_campaigns
  DROP COLUMN IF EXISTS min_order_previous,
  DROP COLUMN IF EXISTS min_order_grace_until;