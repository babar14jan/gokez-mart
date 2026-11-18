WITH released AS (
  UPDATE mart_referral_credits
     SET status = 'available',
         reserved_at = NULL,
         reservation_expires_at = NULL,
         updated_at = NOW()
   WHERE status = 'reserved' AND order_id IS NULL
  RETURNING id, amount, referral_id, customer_id
),
balances AS (
  SELECT c.customer_id,
         COALESCE(SUM(CASE WHEN c.status IN ('available', 'reserved') THEN c.amount ELSE 0 END), 0)::numeric(10,2) AS balance
    FROM mart_referral_credits c
   WHERE c.customer_id IN (SELECT customer_id FROM released)
   GROUP BY c.customer_id
)
INSERT INTO mart_referral_transactions (
  reference, credit_id, referral_id, customer_id,
  type, amount, balance_after, reason, idempotency_key
)
SELECT
  'RESTORE-UNORDERED-' || r.id,
  r.id,
  r.referral_id,
  r.customer_id,
  'restore',
  r.amount,
  COALESCE(b.balance, 0),
  'Reservation released because credits are consumed at order placement',
  'RESTORE-UNORDERED-' || r.id
FROM released r
LEFT JOIN balances b ON b.customer_id = r.customer_id;
