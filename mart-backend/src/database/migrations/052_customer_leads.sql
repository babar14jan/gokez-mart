-- OTP lead tracking is intentionally separate from authenticated customer accounts.
CREATE TABLE IF NOT EXISTS mart_customer_leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                    TEXT NOT NULL UNIQUE,
  customer_id              UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  first_otp_requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_otp_requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  otp_request_count        INTEGER NOT NULL DEFAULT 1,
  verified_at              TIMESTAMPTZ,
  last_successful_login_at TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_customer_leads_verified_at
  ON mart_customer_leads(verified_at);
CREATE INDEX IF NOT EXISTS idx_mart_customer_leads_last_otp_requested_at
  ON mart_customer_leads(last_otp_requested_at DESC);