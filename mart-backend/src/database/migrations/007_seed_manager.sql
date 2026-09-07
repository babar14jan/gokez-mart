-- Migration 007: Seed manager user armanali
-- Username: armanali  Password: 123456
-- Change password after first login

INSERT INTO mart_admins (id, username, password_hash, name, phone, role)
VALUES (
  gen_random_uuid(),
  'armanali',
  '$2a$12$NF.ZQlIwj.rFJjwzmcRqY.V2y8cG18WYzLGyYsL5X42EvNuL9vOMm',
  'Md Arman Ali',
  '8084025786',
  'sales_manager'
)
ON CONFLICT (username) DO NOTHING;
