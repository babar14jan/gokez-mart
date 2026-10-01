-- One address book entry per distinct address, per customer.
--
-- The address book had no uniqueness at all, so every write path was on its own
-- responsible for avoiding duplicates. The order path guarded itself with a
-- NOT EXISTS subquery, but POST /addresses inserted unconditionally and trusted
-- the frontend to filter. LoginFlow calls that endpoint after every successful
-- OTP with isDefault = true, so signing in on a fresh device -- or before the
-- address book finished loading, since the client check only sees the local
-- cache -- produced another copy of the same address and moved the default flag
-- onto the duplicate.
--
-- 1. Collapse any duplicates that already exist, keeping the current default
--    where there is one, otherwise the oldest row. is_default is cleared on the
--    rows being removed first so the surviving row is always a valid default.
-- 2. Add the partial unique index so no future write can reintroduce them, even
--    from a different service or a direct script.
--
-- Normalisation matches the existing NOT EXISTS guard in order.service.ts:
-- lower(btrim(address_line)), so one address is one address regardless of case
-- or surrounding whitespace.

-- 1a. Ensure exactly one default per customer among the surviving rows.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY customer_id, lower(btrim(address_line))
           ORDER BY is_default DESC, created_at ASC, id ASC
         ) AS rn
    FROM mart_customer_addresses
)
UPDATE mart_customer_addresses a
   SET is_default = false
  FROM ranked r
 WHERE a.id = r.id AND r.rn > 1 AND a.is_default;

-- 1b. Drop the surplus copies, keeping the surviving row of each group.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY customer_id, lower(btrim(address_line))
           ORDER BY is_default DESC, created_at ASC, id ASC
         ) AS rn
    FROM mart_customer_addresses
)
DELETE FROM mart_customer_addresses a
 USING ranked r
 WHERE a.id = r.id AND r.rn > 1;

-- 2. Enforce it from now on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_addresses_distinct
    ON mart_customer_addresses (customer_id, lower(btrim(address_line)));