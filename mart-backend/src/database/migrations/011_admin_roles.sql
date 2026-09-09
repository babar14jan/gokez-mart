-- Migration 011: Update mart_admins role constraint for multi-store roles
ALTER TABLE mart_admins DROP CONSTRAINT IF EXISTS mart_admins_role_check;
ALTER TABLE mart_admins ADD CONSTRAINT mart_admins_role_check
  CHECK (role IN ('super_admin', 'store_owner', 'sales_manager', 'delivery_staff', 'staff'));

-- Rename existing sales_manager → store_owner for clarity (keep sales_manager for backward compat)
-- No data change needed — both values are now valid
