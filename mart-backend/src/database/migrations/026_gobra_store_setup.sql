-- Migration 026: Gobra store setup
-- Sets up Gobra store with branding, hours, and marks both stores as live

-- Update Gobra store details
UPDATE mart_stores SET
  owner_name = 'Store Manager',
  support_phone = '',
  is_live = true,
  revenue_model = 'commission',
  commission_percent = 10.00,
  opening_hours = '{
    "mon": {"open": "09:00", "close": "21:00", "closed": false},
    "tue": {"open": "09:00", "close": "21:00", "closed": false},
    "wed": {"open": "09:00", "close": "21:00", "closed": false},
    "thu": {"open": "09:00", "close": "21:00", "closed": false},
    "fri": {"open": "09:00", "close": "21:00", "closed": false},
    "sat": {"open": "09:00", "close": "21:00", "closed": false},
    "sun": {"open": "09:00", "close": "21:00", "closed": false}
  }'::jsonb,
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000002';

-- Update Shapoorji store details
UPDATE mart_stores SET
  owner_name = 'Arman Ali',
  is_live = true,
  revenue_model = 'commission',
  commission_percent = 10.00,
  opening_hours = '{
    "mon": {"open": "09:00", "close": "21:00", "closed": false},
    "tue": {"open": "09:00", "close": "21:00", "closed": false},
    "wed": {"open": "09:00", "close": "21:00", "closed": false},
    "thu": {"open": "09:00", "close": "21:00", "closed": false},
    "fri": {"open": "09:00", "close": "21:00", "closed": false},
    "sat": {"open": "09:00", "close": "21:00", "closed": false},
    "sun": {"open": "09:00", "close": "21:00", "closed": false}
  }'::jsonb,
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Mark all existing products as catalog items
UPDATE mart_products SET is_catalog = true WHERE is_catalog = false;

-- Add fulfilled_by to orders table for store branding
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS fulfilled_by TEXT;

-- Update existing orders with store name
UPDATE mart_orders o
SET fulfilled_by = s.name
FROM mart_stores s
WHERE o.store_id = s.id AND o.fulfilled_by IS NULL;
