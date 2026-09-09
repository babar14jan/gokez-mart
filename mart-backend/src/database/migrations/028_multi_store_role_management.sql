-- Migration 028: Multi-store role management
-- Adds staff role, store assignments table, migrates existing store_id data

-- ── 1. Update role constraint to include staff ────────────────────────────────
ALTER TABLE mart_admins DROP CONSTRAINT IF EXISTS mart_admins_role_check;
ALTER TABLE mart_admins ADD CONSTRAINT mart_admins_role_check
  CHECK (role IN ('super_admin', 'store_owner', 'sales_manager', 'delivery_staff', 'staff'));

-- ── 2. Create store assignments table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_admin_store_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES mart_admins(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES mart_stores(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  assigned_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(admin_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_mart_admin_store_assignments_admin ON mart_admin_store_assignments(admin_id);
CREATE INDEX IF NOT EXISTS idx_mart_admin_store_assignments_store ON mart_admin_store_assignments(store_id);
CREATE INDEX IF NOT EXISTS idx_mart_admin_store_assignments_active ON mart_admin_store_assignments(is_active);

-- ── 3. Migrate existing store_id from mart_admins → assignments table ─────────
-- All non-super_admin users with a store_id get an assignment record
INSERT INTO mart_admin_store_assignments (admin_id, store_id, role, is_active)
SELECT id, store_id, role, true
FROM mart_admins
WHERE store_id IS NOT NULL
  AND role != 'super_admin'
ON CONFLICT (admin_id, store_id) DO NOTHING;

-- ── 4. Add phone column to mart_admins if not exists (for delivery staff lookup)
ALTER TABLE mart_admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
