CREATE TABLE IF NOT EXISTS mart_admin_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES mart_admins(id) ON DELETE CASCADE,
  token_jti   TEXT NOT NULL,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_mart_admin_sessions_admin ON mart_admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_mart_admin_sessions_jti ON mart_admin_sessions(token_jti);
CREATE INDEX IF NOT EXISTS idx_mart_admin_sessions_expires ON mart_admin_sessions(expires_at);
