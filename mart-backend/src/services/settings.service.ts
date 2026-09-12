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
];

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

  static async update(storeId: string, key: string, value: string): Promise<void> {
    await query(
      `UPDATE mart_settings SET value = $1, updated_at = NOW() WHERE store_id = $2 AND key = $3`,
      [value, storeId, key]
    );
  }

  static async updateMany(storeId: string, settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.update(storeId, key, value);
    }
  }
}
