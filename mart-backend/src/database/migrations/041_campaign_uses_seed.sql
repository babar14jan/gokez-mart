-- Migration 041: Campaign Uses

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

-- Campaign definitions are created and managed through the Super Admin Hub UI.
