-- Migration 126: Store the customer-facing scheduled delivery label
ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS scheduled_label TEXT;
