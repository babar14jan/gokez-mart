import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export interface MartStore {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
}

export class StoreService {
  static async findAll(): Promise<MartStore[]> {
    const result = await query<MartStore>(
      `SELECT id, name, address, is_active as "isActive", created_at as "createdAt"
       FROM mart_stores ORDER BY name ASC`
    );
    return result.rows;
  }

  static async findById(id: string): Promise<MartStore | null> {
    const result = await query<MartStore>(
      `SELECT id, name, address, is_active as "isActive", created_at as "createdAt"
       FROM mart_stores WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByZone(zoneId: string): Promise<MartStore | null> {
    const result = await query<MartStore>(
      `SELECT s.id, s.name, s.address, s.is_active as "isActive", s.created_at as "createdAt"
       FROM mart_stores s
       JOIN mart_zones z ON z.store_id = s.id
       WHERE z.id = $1 AND s.is_active = true`,
      [zoneId]
    );
    return result.rows[0] || null;
  }

  static async create(data: { name: string; address?: string }): Promise<MartStore> {
    const id = uuidv4();
    const result = await query<MartStore>(
      `INSERT INTO mart_stores (id, name, address)
       VALUES ($1,$2,$3)
       RETURNING id, name, address, is_active as "isActive", created_at as "createdAt"`,
      [id, data.name, data.address || null]
    );
    return result.rows[0];
  }

  static async update(id: string, data: { name?: string; address?: string; isActive?: boolean }): Promise<MartStore | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.name !== undefined)     { fields.push(`name = $${i++}`);      params.push(data.name); }
    if (data.address !== undefined)  { fields.push(`address = $${i++}`);   params.push(data.address); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(data.isActive); }
    if (!fields.length) return this.findById(id);
    fields.push(`updated_at = NOW()`);
    params.push(id);
    const result = await query<MartStore>(
      `UPDATE mart_stores SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, name, address, is_active as "isActive", created_at as "createdAt"`,
      params
    );
    return result.rows[0] || null;
  }
}
