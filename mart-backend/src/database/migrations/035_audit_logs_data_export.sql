-- Migration 035: Audit logs + data export requests

-- ── Admin audit log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  username    TEXT,
  role        TEXT,
  action      TEXT NOT NULL,  -- e.g. 'login', 'logout', 'create_product', 'delete_user'
  entity_type TEXT,           -- e.g. 'product', 'order', 'user'
  entity_id   TEXT,
  detail      TEXT,           -- human-readable summary
  ip_address  TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin    ON mart_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action   ON mart_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created  ON mart_audit_logs(created_at DESC);

-- ── Customer data export requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mart_data_exports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES mart_customers(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'downloaded')),
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at    TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_data_exports_customer ON mart_data_exports(customer_id);

-- ── Marketing consent column on customers ─────────────────────────────────────
ALTER TABLE mart_customers ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mart_customers ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
