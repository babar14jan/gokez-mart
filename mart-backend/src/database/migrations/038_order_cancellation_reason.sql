-- Migration 038: Add cancellation_reason to orders
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
