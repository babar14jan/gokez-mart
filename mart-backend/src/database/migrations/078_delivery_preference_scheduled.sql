-- Migration 078: Allow "scheduled" delivery preference
-- The storefront now offers a fourth option: a customer who does not need the
-- fastest delivery can book a later window ("scheduled") instead of the three
-- express speeds. The original 019 CHECK allowed only the speed values, so it
-- must be widened; the auto-generated constraint name is the Postgres default.
ALTER TABLE mart_orders
  DROP CONSTRAINT IF EXISTS mart_orders_delivery_preference_check;

ALTER TABLE mart_orders
  ADD CONSTRAINT mart_orders_delivery_preference_check
  CHECK (delivery_preference IN ('within_15', 'within_30', 'within_60', 'scheduled'));
