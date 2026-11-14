-- Promotion audiences classify customers as OTP-verified (signed in) or guest.
-- The join is per customer row, so keep the lead lookup indexed.
CREATE INDEX IF NOT EXISTS idx_mart_customer_leads_verified_customer
  ON mart_customer_leads(customer_id)
  WHERE customer_id IS NOT NULL AND verified_at IS NOT NULL;
