ALTER TABLE mart_promotions
  ADD COLUMN IF NOT EXISTS audience_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_mart_promotion_deliveries_customer_sent_promotion
  ON mart_promotion_deliveries (customer_id, sent_at DESC, promotion_id)
  WHERE status = 'sent' AND sent_at IS NOT NULL AND customer_id IS NOT NULL;