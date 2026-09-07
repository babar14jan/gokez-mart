import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export interface MartCategory {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export class CategoryService {
  static async findAll(activeOnly = false): Promise<MartCategory[]> {
    const where = activeOnly ? `WHERE c.is_active = true` : '';
    const result = await query<MartCategory>(
      `SELECT c.id, c.name, c.slug, c.icon, c.sort_order as "sortOrder",
              c.is_active as "isActive",
              COUNT(p.id)::int as "productCount"
       FROM mart_categories c
       LEFT JOIN mart_products p ON p.category_id = c.id AND p.is_available = true
       ${where}
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    return result.rows;
  }

  static async create(data: Partial<MartCategory>): Promise<MartCategory> {
    const id = uuidv4();
    const result = await query<MartCategory>(
      `INSERT INTO mart_categories (id, name, slug, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, slug, icon, sort_order as "sortOrder", is_active as "isActive"`,
      [id, data.name, data.slug, data.icon || null, data.sortOrder || 0]
    );
    return result.rows[0];
  }

  static async update(id: string, data: Partial<MartCategory>): Promise<MartCategory | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (data.name !== undefined) { fields.push(`name = $${i++}`); params.push(data.name); }
    if (data.slug !== undefined) { fields.push(`slug = $${i++}`); params.push(data.slug); }
    if (data.icon !== undefined) { fields.push(`icon = $${i++}`); params.push(data.icon); }
    if (data.sortOrder !== undefined) { fields.push(`sort_order = $${i++}`); params.push(data.sortOrder); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(data.isActive); }

    if (!fields.length) return null;
    fields.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query<MartCategory>(
      `UPDATE mart_categories SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, name, slug, icon, sort_order as "sortOrder", is_active as "isActive"`,
      params
    );
    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<void> {
    await query(`DELETE FROM mart_categories WHERE id = $1`, [id]);
  }
}
