-- Order item adjustments.
--
-- An order is sometimes delivered with one or more lines missing (item ran out,
-- was damaged, or the customer refused it). The order row and its items are the
-- source of truth for revenue, so the correction must change those rows, not sit
-- beside them. Deleting or shrinking the line would otherwise erase the fact
-- that the customer originally ordered it.
--
-- This table is that audit trail: one row per adjusted line, capturing the
-- ordered quantity, the quantity actually delivered, the money removed, and who
-- did it. `order_item_id` is deliberately not a foreign key because a fully
-- undelivered line is deleted from mart_order_items after the snapshot is taken.
CREATE TABLE IF NOT EXISTS mart_order_item_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES mart_orders(id) ON DELETE CASCADE,
  order_item_id      UUID,
  product_id         UUID,
  product_name       TEXT NOT NULL,
  unit               TEXT NOT NULL,
  price              NUMERIC(10,2) NOT NULL,
  previous_quantity  INTEGER NOT NULL,
  delivered_quantity INTEGER NOT NULL,
  removed_quantity   INTEGER NOT NULL,
  removed_amount     NUMERIC(10,2) NOT NULL,
  reason             TEXT,
  adjusted_by        UUID REFERENCES mart_admins(id) ON DELETE SET NULL,
  adjusted_by_name   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_item_adjustments_order
  ON mart_order_item_adjustments(order_id, created_at DESC);
