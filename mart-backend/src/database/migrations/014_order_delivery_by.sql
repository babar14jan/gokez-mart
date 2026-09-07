-- Migration 014: Track who marked order as out_for_delivery
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS delivery_by UUID REFERENCES mart_admins(id) ON DELETE SET NULL;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS delivery_by_name TEXT;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS delivery_by_phone TEXT;
