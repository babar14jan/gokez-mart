-- Migration 093: guest push subscriptions
--
-- Push subscriptions were keyed on customer_id (members) or admin_id (staff).
-- A guest shopper has neither, so they could never receive order pushes. Guests
-- already hold an unguessable per-order tracking_token on their device, so we
-- key guest subscriptions on that token instead.
--
-- A guest row therefore has tracking_token set and customer_id / admin_id NULL.
-- On OTP login the device's rows are re-keyed to customer_id (see
-- PushService.rekeyGuestSubscriptions) so the same device does not receive both
-- a member push and a guest push for one order.

ALTER TABLE mart_push_subscriptions ADD COLUMN IF NOT EXISTS tracking_token TEXT;

CREATE INDEX IF NOT EXISTS idx_push_subs_tracking_token
  ON mart_push_subscriptions(tracking_token)
  WHERE tracking_token IS NOT NULL;
