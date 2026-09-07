-- Migration 004: Seed default mart admin user
-- Username: babarali  Password: boss321
-- Change password after first login via My Profile → Change Password

INSERT INTO mart_admins (id, username, password_hash, name, phone, role)
VALUES (
  gen_random_uuid(),
  'babarali',
  '$2a$12$CbxN5Fs1Uv4hfcBHleL7O.nmZOHOsDhwCcuG..0mHM6MDJgcHgdvG',
  'Md Babar Ali',
  '9330317102',
  'super_admin'
)
ON CONFLICT (username) DO NOTHING;
