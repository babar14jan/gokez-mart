-- Merchant onboarding records declarations for manual review; documents are not
-- collected until the applicable legal requirement has been confirmed.
ALTER TABLE mart_store_applications
  ADD COLUMN IF NOT EXISTS product_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gst_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (gst_status IN ('registered', 'not_registered', 'not_applicable', 'unknown')),
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS fssai_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (fssai_status IN ('registered', 'not_registered', 'not_applicable', 'unknown')),
  ADD COLUMN IF NOT EXISTS fssai_number TEXT,
  ADD COLUMN IF NOT EXISTS local_permission_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (local_permission_status IN ('available', 'not_available', 'not_applicable', 'unknown')),
  ADD COLUMN IF NOT EXISTS merchant_delivery_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS direct_payment_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_version TEXT,
  ADD COLUMN IF NOT EXISTS agreement_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_declaration_accepted_at TIMESTAMPTZ;

-- Gokez Mart is subscription-only. Existing monthly fee values are retained;
-- the commission setting is retired and cannot be selected for new stores.
ALTER TABLE mart_stores DROP CONSTRAINT IF EXISTS mart_stores_revenue_model_check;

UPDATE mart_stores
SET revenue_model = 'subscription', commission_percent = 0
WHERE revenue_model IN ('commission', 'flat', 'both');

ALTER TABLE mart_stores
  ADD CONSTRAINT mart_stores_revenue_model_check
  CHECK (revenue_model = 'subscription');
ALTER TABLE mart_stores ALTER COLUMN revenue_model SET DEFAULT 'subscription';