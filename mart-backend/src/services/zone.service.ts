import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export interface MartZone {
  id: string;
  storeId: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  isActive: boolean;
  sortOrder: number;
}

export class ZoneService {
  static async findAll(activeOnly = false, storeId?: string): Promise<MartZone[]> {
    const conditions: string[] = [];
    if (activeOnly) conditions.push(`is_active = true`);
    if (storeId) conditions.push(`store_id = '${storeId}'`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query<MartZone>(
      `SELECT id, store_id as "storeId", name, lat::float, lng::float,
              radius_km::float as "radiusKm",
              is_active as "isActive", sort_order as "sortOrder"
       FROM mart_zones ${where}
       ORDER BY sort_order ASC, name ASC`
    );
    return result.rows;
  }

  static async create(data: Partial<MartZone>): Promise<MartZone> {
    const id = uuidv4();
    const result = await query<MartZone>(
      `INSERT INTO mart_zones (id, store_id, name, lat, lng, radius_km, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, store_id as "storeId", name, lat::float, lng::float,
                 radius_km::float as "radiusKm",
                 is_active as "isActive", sort_order as "sortOrder"`,
      [id, data.storeId, data.name, data.lat, data.lng, data.radiusKm ?? 5, data.isActive !== false, data.sortOrder ?? 0]
    );
    return result.rows[0];
  }

  static async update(id: string, data: Partial<MartZone>): Promise<MartZone | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.name !== undefined)     { fields.push(`name = $${i++}`);      params.push(data.name); }
    if (data.lat !== undefined)      { fields.push(`lat = $${i++}`);       params.push(data.lat); }
    if (data.lng !== undefined)      { fields.push(`lng = $${i++}`);       params.push(data.lng); }
    if (data.radiusKm !== undefined) { fields.push(`radius_km = $${i++}`); params.push(data.radiusKm); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(data.isActive); }
    if (data.sortOrder !== undefined){ fields.push(`sort_order = $${i++}`);params.push(data.sortOrder); }
    if (!fields.length) return null;
    fields.push(`updated_at = NOW()`);
    params.push(id);
    const result = await query<MartZone>(
      `UPDATE mart_zones SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, name, lat::float, lng::float,
                 radius_km::float as "radiusKm",
                 is_active as "isActive", sort_order as "sortOrder"`,
      params
    );
    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<void> {
    await query(`DELETE FROM mart_zones WHERE id = $1`, [id]);
  }
}
