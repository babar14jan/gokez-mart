ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency_key ON mart_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE mart_feedback ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_idempotency_key ON mart_feedback(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE mart_grievances ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_grievances_idempotency_key ON mart_grievances(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE mart_inventory_log ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_log_idempotency_key ON mart_inventory_log(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_order_deduction
  ON mart_inventory_log(product_id, store_id, reference_id, reason)
  WHERE reason = 'order_deducted';

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_uses_order ON mart_campaign_uses(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_deletion_request
  ON mart_deletion_requests(customer_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_data_consent
  ON mart_consents(customer_id, consent_type) WHERE consent_type = 'personal_data';