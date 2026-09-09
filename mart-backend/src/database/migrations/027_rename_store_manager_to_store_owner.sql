-- Migration 027: Rename store_manager role to store_owner
-- Drop old constraint first
ALTER TABLE mart_admins DROP CONSTRAINT IF EXISTS mart_admins_role_check;

-- Update existing rows
UPDATE mart_admins SET role = 'store_owner' WHERE role = 'store_manager';

-- Add new constraint with store_owner
ALTER TABLE mart_admins ADD CONSTRAINT mart_admins_role_check
  CHECK (role IN ('super_admin', 'store_owner', 'sales_manager', 'delivery_staff', 'staff'));
