-- Migration 043: Customer address book (multiple labeled addresses per customer)

CREATE TABLE IF NOT EXISTS mart_customer_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES mart_customers(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'Home',
  address_line TEXT NOT NULL,
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_customer_addresses_customer ON mart_customer_addresses(customer_id);

-- Best-effort seed from legacy single-address fields so existing users see their address in the new book.
INSERT INTO mart_customer_addresses (customer_id, label, address_line, is_default)
SELECT id, 'Home', address, true FROM mart_customers
WHERE address IS NOT NULL AND TRIM(address) <> '';

INSERT INTO mart_customer_addresses (customer_id, label, address_line, is_default)
SELECT id, 'Other', address2, false FROM mart_customers
WHERE address2 IS NOT NULL AND TRIM(address2) <> '';
