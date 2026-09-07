-- Migration 018: DPDP Act 2023 compliance tables

-- ── Consent records ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_consents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID REFERENCES mart_customers(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL DEFAULT 'personal_data'
               CHECK (consent_type IN ('personal_data', 'marketing', 'location')),
  granted      BOOLEAN NOT NULL DEFAULT true,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_consents_customer ON mart_consents(customer_id);

-- ── Account deletion requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_deletion_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Grievances ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_grievances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  response     TEXT,
  resolved_by  UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_grievances_customer ON mart_grievances(customer_id);
CREATE INDEX IF NOT EXISTS idx_mart_grievances_status   ON mart_grievances(status);
