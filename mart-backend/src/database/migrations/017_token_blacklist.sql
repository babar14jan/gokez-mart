-- Migration 017: JWT token blacklist for secure logout
CREATE TABLE IF NOT EXISTS mart_token_blacklist (
  jti        TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_token_blacklist_expires ON mart_token_blacklist(expires_at);
