import { query } from '../database/db';

export interface MartSetting {
  key: string;
  value: string;
  label: string;
}

const PUBLIC_KEYS = [
  'store_name', 'store_address', 'delivery_charge', 'free_delivery_above',
  'min_order_amount', 'delivery_area', 'store_open', 'estimated_delivery',
  'cod_enabled', 'upi_enabled', 'upi_qr_enabled', 'phonepay_qr_url',
  'upi_phone', 'upi_id', 'whatsapp_number', 'support_name', 'support_phone',
  'inventory_tracking', 'auto_out_of_stock', 'low_stock_threshold',
  // The store's own wording for the closed notice, and the closure it
  // scheduled. Public because the storefront renders the wording in the banner
  // and needs the schedule to know when the store is back. All written from
  // the hub's Hours tab.
  'store_closed_message', 'store_closed_greeting',
  'store_closed_from', 'store_closed_until',
];

// Store name and address live only on mart_stores (hub Stores page). They used
// to be editable as settings too, which let the storefront and receipts show
// different values for the same store. Ignore any attempt to write them here so
// a stale client or a direct API call cannot resurrect the duplicate copy.
const PROTECTED_KEYS = new Set(['store_name', 'store_address']);

export class SettingsService {
  static async getAll(storeId: string): Promise<MartSetting[]> {
    const result = await query<MartSetting>(
      `SELECT key, value, label FROM mart_settings WHERE store_id = $1 ORDER BY key ASC`,
      [storeId]
    );
    return result.rows;
  }

  static async getPublic(storeId: string): Promise<Record<string, string>> {
    const result = await query<MartSetting>(
      `SELECT key, value FROM mart_settings WHERE store_id = $1 AND key = ANY($2)`,
      [storeId, PUBLIC_KEYS]
    );
    return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
  }

  static async get(storeId: string, key: string): Promise<string | null> {
    const result = await query<{ value: string }>(
      `SELECT value FROM mart_settings WHERE store_id = $1 AND key = $2`,
      [storeId, key]
    );
    return result.rows[0]?.value ?? null;
  }

  /**
   * Write one setting.
   *
   * An upsert, not an update. A plain UPDATE only touches rows that already
   * exist, so a setting that had never been set could never be created: the
   * hub would show the field, the admin would fill it in, the save would
   * report success, and the value would be silently dropped. Every setting
   * that was ever added started life with no row, so this was a trap for any
   * new key.
   */
  static async update(storeId: string, key: string, value: string): Promise<void> {
    await query(
      `INSERT INTO mart_settings (store_id, key, value, updated_at)
       VALUES ($2, $3, $1, NOW())
       ON CONFLICT (store_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [value, storeId, key]
    );
  }

  static async updateMany(storeId: string, settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (PROTECTED_KEYS.has(key)) continue;
      await this.update(storeId, key, value);
    }
  }
}
