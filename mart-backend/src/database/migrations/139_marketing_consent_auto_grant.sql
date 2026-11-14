-- Auto-grant marketing consent on signup. Promotional messages go out to all
-- customers by default; they can still opt out later via the compliance flow.
UPDATE mart_customers
SET marketing_consent = true,
    marketing_consent_at = COALESCE(marketing_consent_at, NOW())
WHERE marketing_consent = false;

INSERT INTO mart_consents (id, customer_id, consent_type, granted)
SELECT gen_random_uuid(), c.id, 'marketing', true
FROM mart_customers c
WHERE NOT EXISTS (
  SELECT 1 FROM mart_consents mc
  WHERE mc.customer_id = c.id AND mc.consent_type = 'marketing'
);

ALTER TABLE mart_customers ALTER COLUMN marketing_consent SET DEFAULT true;
