-- Live test sends must be auditable without polluting real audience analytics
-- or the "promotion sent in last 7 days" suppression window.
ALTER TABLE mart_promotion_deliveries
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mart_promotion_deliveries_test
  ON mart_promotion_deliveries(promotion_id, created_at DESC)
  WHERE is_test;
