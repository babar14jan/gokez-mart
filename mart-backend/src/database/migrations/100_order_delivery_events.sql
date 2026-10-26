-- Structured operational delivery events that are not order status transitions.
CREATE TABLE IF NOT EXISTS mart_order_delivery_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES mart_orders(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('rescheduled')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  actor_id      UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  actor_name    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_delivery_events_order
  ON mart_order_delivery_events(order_id, created_at ASC);
