-- Migration 009: Add secondary address to mart_customers
ALTER TABLE mart_customers ADD COLUMN IF NOT EXISTS address2 TEXT;
