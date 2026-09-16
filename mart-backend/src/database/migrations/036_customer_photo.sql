-- Migration 036: Customer profile photo
ALTER TABLE mart_customers ADD COLUMN IF NOT EXISTS photo_url TEXT;
