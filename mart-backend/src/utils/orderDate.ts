/**
 * SQL expression for the date an order belongs to in the hub.
 *
 * Mirrors the storefront/hub browse rule: active scheduled orders belong to
 * their delivery slot, delivered orders to the moment they were delivered, and
 * stopped orders to the event that ended them. Everything else stays on the
 * date it was placed.
 */
export const ORDER_BROWSE_DATE_SQL = `(
  CASE
    WHEN o.delivery_preference = 'scheduled'
      AND o.status NOT IN ('delivered','cancelled','failed_delivery','terminated')
      AND o.scheduled_for IS NOT NULL
      THEN o.scheduled_for
    WHEN o.status = 'delivered' AND o.delivered_at IS NOT NULL
      THEN o.delivered_at
    WHEN o.status IN ('delivered','cancelled','failed_delivery','terminated')
      THEN COALESCE((
        SELECT MAX(e.created_at)
        FROM mart_order_status_events e
        WHERE e.order_id = o.id AND e.to_status = o.status
      ), o.created_at)
    ELSE o.created_at
  END
)`;
