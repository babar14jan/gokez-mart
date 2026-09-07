-- Migration 002: Add name column to mart_admins
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS name TEXT;
