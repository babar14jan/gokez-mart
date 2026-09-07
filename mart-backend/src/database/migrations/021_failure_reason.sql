-- Migration 021: Add failure_reason for failed deliveries
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS failure_reason TEXT;
