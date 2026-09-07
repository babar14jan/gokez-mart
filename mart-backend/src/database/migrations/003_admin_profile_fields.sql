-- Migration 003: Add profile fields to mart_admins
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin'
  CHECK (role IN ('super_admin', 'sales_manager', 'staff'));
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
