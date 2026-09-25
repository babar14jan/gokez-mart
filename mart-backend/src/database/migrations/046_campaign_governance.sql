-- Super Admin-managed campaign governance and reversible redemptions.

ALTER TABLE mart_campaigns
  ADD COLUMN IF NOT EXISTS eligibility_type TEXT NOT NULL DEFAULT 'all'
    CHECK (eligibility_type IN ('all', 'first_order', 'inactive_customers', 'targeted_customers')),
  ADD COLUMN IF NOT EXISTS inactive_days INT,
  ADD COLUMN IF NOT EXISTS stacking_policy TEXT NOT NULL DEFAULT 'exclusive'
    CHECK (stacking_policy IN ('exclusive')),
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;

ALTER TABLE mart_campaigns
  DROP CONSTRAINT IF EXISTS mart_campaigns_status_check;

ALTER TABLE mart_campaigns
  ADD CONSTRAINT mart_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'expired', 'archived'));

ALTER TABLE mart_campaigns
  DROP CONSTRAINT IF EXISTS mart_campaigns_inactive_days_check;

ALTER TABLE mart_campaigns
  ADD CONSTRAINT mart_campaigns_inactive_days_check
  CHECK (
    (eligibility_type = 'inactive_customers' AND inactive_days IS NOT NULL AND inactive_days > 0)
    OR (eligibility_type <> 'inactive_customers' AND inactive_days IS NULL)
  );

ALTER TABLE mart_campaign_uses
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE TABLE IF NOT EXISTS mart_campaign_targets (
  campaign_id UUID NOT NULL REFERENCES mart_campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES mart_customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_targets_customer
  ON mart_campaign_targets(customer_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_uses_active_customer
  ON mart_campaign_uses(campaign_id, customer_id) WHERE reversed_at IS NULL;
