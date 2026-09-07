-- Migration 013: Fix Gobra zone to point to Gobra store
UPDATE mart_zones
SET store_id = '00000000-0000-0000-0000-000000000002'
WHERE name = 'Gobra' AND store_id = '00000000-0000-0000-0000-000000000001';
