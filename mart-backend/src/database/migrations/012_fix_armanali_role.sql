-- Migration 012: Fix armanali role to store_manager and assign to Shapoorji store
UPDATE mart_admins
SET role = 'store_manager',
    store_id = '00000000-0000-0000-0000-000000000001'
WHERE username = 'armanali';
