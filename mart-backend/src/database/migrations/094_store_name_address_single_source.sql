-- Migration 094: make mart_stores the single source of truth for store name/address
--
-- Store name and address were editable in two places that wrote to two tables:
--   * Hub "Stores" page  -> mart_stores.name / mart_stores.address
--   * Hub "Settings" page -> mart_settings rows 'store_name' / 'store_address'
-- The storefront (Account page, WhatsApp message) read the mart_settings copy
-- while receipts, order detail and tracking read mart_stores (via the order
-- projection). The same store could therefore show one name/address on the
-- storefront and a different one on a receipt.
--
-- We standardise on mart_stores. The customer-facing value (mart_settings) is
-- the one customers currently see, so it wins where the two disagree. The
-- duplicate settings keys are then removed so nothing can write a second copy
-- again (the API also refuses those keys; see SettingsService.PROTECTED_KEYS).

-- Backfill the name where a setting exists and differs from the store record.
UPDATE mart_stores s
SET name = n.value, updated_at = NOW()
FROM mart_settings n
WHERE n.store_id = s.id
  AND n.key = 'store_name'
  AND n.value IS NOT NULL
  AND n.value IS DISTINCT FROM s.name;

-- Backfill the address where a setting exists and differs from the store record.
UPDATE mart_stores s
SET address = a.value, updated_at = NOW()
FROM mart_settings a
WHERE a.store_id = s.id
  AND a.key = 'store_address'
  AND a.value IS NOT NULL
  AND a.value IS DISTINCT FROM s.address;

-- Drop the duplicate keys so there is exactly one writable copy of each.
DELETE FROM mart_settings WHERE key IN ('store_name', 'store_address');
