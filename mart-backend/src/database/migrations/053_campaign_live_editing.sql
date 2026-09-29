-- Migration 053: live campaign editing.
--
-- Lets a Super Admin change a running campaign's commercial terms (discount,
-- minimum order, limits, eligibility) without freezing the campaign. Integrity
-- is preserved by making each redemption self-describing instead of by
-- freezing the parent row:
--
--   mart_campaign_uses.terms_snapshot  the terms in force at the moment of
--                                     redemption, so a later edit can never
--                                     rewrite what a customer actually got.
--   mart_campaign_changes             append-only audit log of edits made to a
--                                     campaign that already has redemptions.
--   mart_campaigns.superseded_by      explicit version chain, so a coupon code
--                                     (which is already published on the live
--                                     carousel) is superseded rather than
--                                     mutated in place.
--
-- Grandfathering: raising min_order_amount would otherwise strand a customer
-- who is already part-way to the discount. The previous threshold is retained
-- for a grace window so in-progress carts still qualify.

ALTER TABLE mart_campaign_uses
  ADD COLUMN IF NOT EXISTS terms_snapshot JSONB;

CREATE TABLE IF NOT EXISTS mart_campaign_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES mart_campaigns(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  changed_by  UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_changes_campaign
  ON mart_campaign_changes(campaign_id, created_at DESC);

ALTER TABLE mart_campaigns
  ADD COLUMN IF NOT EXISTS superseded_by     UUID REFERENCES mart_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS min_order_previous  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS min_order_grace_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_superseded_by
  ON mart_campaigns(superseded_by);

-- Backfill the redemptions that predate this migration so the ledger is
-- uniformly queryable. Best effort: terms are inferred from the campaign's
-- current row, which is the best available answer for historical uses.
UPDATE mart_campaign_uses cu
SET terms_snapshot = jsonb_build_object(
      'discount_type',      c.discount_type,
      'discount_value',     c.discount_value,
      'max_discount',       c.max_discount,
      'min_order_amount',   c.min_order_amount,
      'per_customer_limit', c.per_customer_limit,
      'coupon_code',        c.coupon_code,
      'eligibility_type',   c.eligibility_type,
      'inferred',           true
    )
FROM mart_campaigns c
WHERE c.id = cu.campaign_id
  AND cu.terms_snapshot IS NULL;
