-- Migration 006: Customer OTP auth for mart storefront

CREATE TABLE IF NOT EXISTS mart_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  otp        TEXT NOT NULL,
  session_id TEXT,                    -- 2Factor session ID for verification
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_otps_phone ON mart_otps(phone);

-- Add last_seen to mart_customers
ALTER TABLE mart_customers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
