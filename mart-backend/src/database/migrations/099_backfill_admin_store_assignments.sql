-- Migration 099: restore missing store assignments for primary-store admins.
--
-- adminCreateUser wrote mart_admins.store_id but not mart_admin_store_assignments,
-- while the Team screen and the order-assignment dropdown read assignments. Those
-- users (for example delivery staff added from the Users screen) therefore existed
-- and could authenticate, but never appeared when assigning an order.
--
-- Only missing assignments for a user's primary store are inserted. An existing
-- inactive row means the member was deliberately removed from that store, so it
-- is left alone.

INSERT INTO mart_admin_store_assignments (admin_id, store_id, role, is_active)
SELECT id, store_id, role, true
FROM mart_admins
WHERE store_id IS NOT NULL
  AND role <> 'super_admin'
ON CONFLICT (admin_id, store_id) DO NOTHING;
