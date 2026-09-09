-- Migration 024: Multi-store marketplace — store branding, hours, revenue model

-- Store branding & operations
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS support_phone TEXT;
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS opening_hours JSONB DEFAULT '{
  "mon": {"open": "09:00", "close": "21:00", "closed": false},
  "tue": {"open": "09:00", "close": "21:00", "closed": false},
  "wed": {"open": "09:00", "close": "21:00", "closed": false},
  "thu": {"open": "09:00", "close": "21:00", "closed": false},
  "fri": {"open": "09:00", "close": "21:00", "closed": false},
  "sat": {"open": "09:00", "close": "21:00", "closed": false},
  "sun": {"open": "09:00", "close": "21:00", "closed": false}
}'::jsonb;
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT false;

-- Revenue model
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS revenue_model TEXT NOT NULL DEFAULT 'commission'
  CHECK (revenue_model IN ('commission', 'flat', 'both'));
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00;
ALTER TABLE mart_stores ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Mark existing stores as live
UPDATE mart_stores SET is_live = true WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

-- Store onboarding applications
CREATE TABLE IF NOT EXISTS mart_store_applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name  TEXT NOT NULL,
  owner_name  TEXT NOT NULL,
  phone       TEXT NOT NULL,
  area        TEXT NOT NULL,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_store_applications_status ON mart_store_applications(status);
