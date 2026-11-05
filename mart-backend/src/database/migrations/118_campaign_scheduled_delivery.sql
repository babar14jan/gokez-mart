-- Migration 118: Campaigns that can only be redeemed with scheduled delivery.
--
-- A next-day coupon is not a normal offer: it must not be applied to the
-- fastest/immediate delivery option. The storefront pairs the coupon with the
-- schedule picker, and order placement rejects it unless the customer has
-- committed a scheduled window.

ALTER TABLE mart_campaigns
  ADD COLUMN IF NOT EXISTS requires_scheduled_delivery BOOLEAN NOT NULL DEFAULT false;
