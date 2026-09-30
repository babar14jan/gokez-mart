-- Migration 056: make store_manager a real role, retire sales_manager
--
-- store_manager has been referenced by the hub frontend since commit 8a719e5
-- (ROLE_ROUTES, NAV_ALL, BOTTOM_NAV, three role pickers, five label maps) but
-- could never exist: mart_admins_role_check never permitted it. Every one of
-- those call sites was dead code behind comments admitting the role was
-- "frontend-only / unreachable".
--
-- sales_manager is being retired in favour of store_manager. It is a real,
-- live role today, so this is a data migration, not just a constraint swap.
--
-- DEPLOYMENT ORDER: apply this migration BEFORE deploying the backend/hub that
-- reads the new role list. The new ADMIN_ROLES no longer contains
-- 'sales_manager', so authenticate fails closed for that role. If the code ships
-- first, every live sales_manager account is locked out until the migration is
-- applied -- and those accounts cannot be converted once the backend refuses to
-- authenticate them.
--
-- ORDER MATTERS, and it is the opposite of what it first looks like.
--
-- The pre-existing mart_admins_role_check permits exactly the old five values,
-- which INCLUDES 'sales_manager' and EXCLUDES 'store_manager'. A CHECK is
-- enforced on every write, so converting a row to store_manager while that
-- constraint is still in place raises:
--   ERROR: new row for relation "mart_admins" violates check constraint
--          "mart_admins_role_check"
-- The constraint therefore has to be dropped BEFORE the conversion, not after.
-- Verified against a live database: doing the UPDATE first fails on any account
-- that actually holds the role, which is precisely the row this migration
-- exists to fix.
--
-- The whole file is applied as a single simple query, so Postgres runs it in one
-- implicit transaction and the unconstrained window below is never observable by
-- another session.

-- ── 1. Drop the old constraint before touching any rows ─────────────────────
ALTER TABLE mart_admins DROP CONSTRAINT IF EXISTS mart_admins_role_check;

-- ── 2. Move any surviving sales_manager accounts onto store_manager ──────────
-- Idempotent: a second run updates zero rows.
UPDATE mart_admins
   SET role = 'store_manager',
       updated_at = NOW()
 WHERE role = 'sales_manager';

-- The per-store assignment table carries its own unconstrained role column and
-- is what the Team page actually displays, so it has to move too. Left behind,
-- the Team page would show "Sales Manager" for an account the constraint now
-- calls a Store Manager. Safe to run before the new CHECK is added, because
-- this table has no constraint to violate yet.
UPDATE mart_admin_store_assignments
   SET role = 'store_manager',
       updated_at = NOW()
 WHERE role = 'sales_manager';

-- ── 3. Rebuild the constraint ────────────────────────────────────────────────
ALTER TABLE mart_admins ADD CONSTRAINT mart_admins_role_check
  CHECK (role IN ('super_admin', 'store_owner', 'store_manager', 'delivery_staff', 'staff'));

-- ── 3. Pin the assignment role too ───────────────────────────────────────────
-- mart_admin_store_assignments.role had no constraint at all, so any string
-- could be written to it by a store owner via the team endpoints. It mirrors
-- mart_admins.role, so it gets the same five values. Rows that are already
-- invalid would block this, so map anything unknown to 'staff' first.
UPDATE mart_admin_store_assignments
   SET role = 'staff'
 WHERE role IS NOT NULL
   AND role NOT IN ('super_admin', 'store_owner', 'store_manager', 'delivery_staff', 'staff');

ALTER TABLE mart_admin_store_assignments
  DROP CONSTRAINT IF EXISTS mart_admin_store_assignments_role_check;
ALTER TABLE mart_admin_store_assignments
  ADD CONSTRAINT mart_admin_store_assignments_role_check
  CHECK (role IN ('super_admin', 'store_owner', 'store_manager', 'delivery_staff', 'staff'));
