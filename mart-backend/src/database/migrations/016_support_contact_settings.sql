-- Migration 016: Add support contact settings
INSERT INTO mart_settings (key, value, label, store_id)
SELECT 'support_name', '', 'Support Contact Name', id FROM mart_stores
ON CONFLICT (store_id, key) DO NOTHING;

INSERT INTO mart_settings (key, value, label, store_id)
SELECT 'support_phone', '', 'Support Phone Number', id FROM mart_stores
ON CONFLICT (store_id, key) DO NOTHING;
