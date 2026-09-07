-- Migration 019: Delivery preference, note, batch dispatch
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS delivery_preference TEXT NOT NULL DEFAULT 'within_15'
  CHECK (delivery_preference IN ('within_15', 'within_30', 'within_60'));

ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS delivery_note TEXT;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS delivery_sequence INTEGER;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_mart_orders_batch ON mart_orders(batch_id);
