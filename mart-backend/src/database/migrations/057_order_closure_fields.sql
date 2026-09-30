-- Migration 057: record orders placed while the store was shut
--
-- Customers may order at any hour. A closed store is not a blocked store, so
-- nothing here prevents checkout; the columns exist so the hub can tell a
-- 9:05 PM order placed after closing apart from a 9:05 PM order placed while
-- trading, and so staff know to hold it rather than treat it as late.
--
-- The flag is written by the server, not the client. The storefront already
-- knows whether it is closed, but a client-supplied flag would be forgeable and
-- would also disagree with the server's own reading of the schedule. Server-side
-- evaluation also means the recorded value is correct even if the customer's
-- device clock is wrong or their timezone is not IST.

ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS placed_outside_hours BOOLEAN NOT NULL DEFAULT false;

-- The reason is stored rather than inferred later. "manual" (the owner switched
-- the store off) and "outside_hours" (outside the posted schedule) call for
-- different handling, and neither implies a promised reopening time.
ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS closed_reason TEXT
  DEFAULT NULL
  CHECK (closed_reason IS NULL OR closed_reason IN ('manual', 'outside_hours', 'never_opens'));

-- When the order is expected to be picked up. NULL while the store is open, and
-- NULL for a manual closure, where no time was ever promised.
ALTER TABLE mart_orders
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- Index for the hub filter. Partial, because only out-of-hours orders are ever
-- queried by this column and they are a small fraction of the table.
CREATE INDEX IF NOT EXISTS idx_mart_orders_outside_hours
  ON mart_orders (created_at DESC)
  WHERE placed_outside_hours = true;

-- Kept consistent with the flag: an order flagged as placed while shut must say
-- why, unless it was placed while the store was open. A manual closure never
-- carries a scheduled_for, because the owner gave no reopening time.
ALTER TABLE mart_orders
  DROP CONSTRAINT IF EXISTS mart_orders_closure_consistency;
ALTER TABLE mart_orders
  ADD CONSTRAINT mart_orders_closure_consistency
  CHECK (
    (placed_outside_hours = false AND closed_reason IS NULL AND scheduled_for IS NULL)
    OR (placed_outside_hours = true  AND closed_reason IS NOT NULL)
  );
