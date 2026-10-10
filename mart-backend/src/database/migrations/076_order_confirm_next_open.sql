-- Confirmation for the next opening hours.
--
-- When the store is shut and an order arrives, it sits at 'pending' until the
-- store opens. Instead of a new status (which would ripple through every status
-- screen, analytics KPI and transition guard), the hub's "Confirm for next
-- opening hours" action reuses the normal pending -> confirmed transition and
-- records the acknowledgement here: the customer's card shows a clear promise,
-- the customer gets a push, and the hub can count how many after-hours orders
-- were accepted.
ALTER TABLE mart_orders ADD COLUMN confirmed_next_open boolean NOT NULL DEFAULT false;