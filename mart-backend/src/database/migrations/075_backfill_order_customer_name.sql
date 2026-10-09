-- Backfill the order display name for orders stored with the 'Customer' placeholder.
--
-- A verified customer whose account had no name could place an order and have the
-- literal 'Customer' written to mart_orders.guest_name. The order path now resolves
-- the real name from the account (see controllers/index.ts), so this cleans up the
-- rows already on record and the hub/receipts show the customer's name instead.
--
-- Only rows that are actually blank or the placeholder are touched, and only when
-- the linked customer has a real name, so a name the customer typed is never
-- overwritten. The customer is matched by customer_id when present, and only falls
-- back to the (unique) phone when the order predates customer linking.
UPDATE mart_orders o
SET guest_name = c.name
FROM mart_customers c
WHERE c.name IS NOT NULL
  AND btrim(c.name) <> ''
  AND lower(btrim(c.name)) <> 'customer'
  AND (
    o.customer_id = c.id
    OR (o.customer_id IS NULL AND o.guest_phone = c.phone)
  )
  AND (btrim(o.guest_name) = '' OR lower(btrim(o.guest_name)) = 'customer');
