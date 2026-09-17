-- Migration 041: Campaign Uses + WELCOME50 Seed

CREATE TABLE IF NOT EXISTS mart_campaign_uses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES mart_campaigns(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  order_id         UUID REFERENCES mart_orders(id) ON DELETE SET NULL,
  discount_applied NUMERIC(10,2) NOT NULL DEFAULT 0,
  coupon_code_used TEXT,
  used_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_uses_campaign  ON mart_campaign_uses(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_uses_customer  ON mart_campaign_uses(customer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_uses_order     ON mart_campaign_uses(order_id);

-- Add campaign fields to mart_orders
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS campaign_id      UUID REFERENCES mart_campaigns(id) ON DELETE SET NULL;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS campaign_discount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS coupon_code_used  TEXT;

-- Seed WELCOME50 campaign
INSERT INTO mart_campaigns (
  title, subtitle, description, badge_text,
  discount_type, discount_value, min_order_amount,
  coupon_code, new_customers_only, per_customer_limit,
  show_in_carousel, carousel_gradient,
  status, valid_from
) VALUES (
  'Welcome Offer',
  '₹50 off your first order',
  'Welcome to Gokez Mart! Enjoy ₹50 off on your very first order. No minimum order required.',
  '🎉 New User',
  'flat', 50, 0,
  NULL,   -- auto-applied, no code needed
  true,   -- new customers only
  1,
  true,
  'from-violet-500 via-purple-600 to-indigo-600',
  'active',
  NOW()
) ON CONFLICT DO NOTHING;
