ALTER TABLE mart_campaigns
  ADD COLUMN IF NOT EXISTS allow_redemption_until_used BOOLEAN NOT NULL DEFAULT false;