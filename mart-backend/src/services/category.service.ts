import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { badRequest, conflict } from '../utils/apiError';

export const PRODUCT_PREFIX_PATTERN = /^[A-Z]{2,6}$/;

// A category slug is a stable key used in links and Home/Fresh configs. Keep it
// to lowercase words joined by single hyphens so every reference is unambiguous.
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeCategorySlug(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('Category slug is required');
  }
  const slug = value.trim().toLowerCase();
  if (!CATEGORY_SLUG_PATTERN.test(slug)) {
    throw badRequest('Category slug must be lowercase letters, numbers and single hyphens (e.g. leafy-greens)');
  }
  return slug;
}

export function normalizeProductPrefix(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('Product prefix is required');
  }
  const productPrefix = value.trim().toUpperCase();
  if (!PRODUCT_PREFIX_PATTERN.test(productPrefix)) {
    throw badRequest('Product prefix must be 2 to 6 letters');
  }
  return productPrefix;
}

export interface MartCategory {
  id: string;
  name: string;
  slug: string;
  productPrefix: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export class CategoryService {
  static async findAll(activeOnly = false): Promise<MartCategory[]> {
    const where = activeOnly ? `WHERE c.is_active = true` : '';
    const result = await query<MartCategory>(
      `SELECT c.id, c.name, c.slug, c.product_prefix as "productPrefix", c.icon, c.sort_order as "sortOrder",
              c.is_active as "isActive",
              COUNT(p.id)::int as "productCount"
       FROM mart_categories c
       LEFT JOIN mart_products p ON p.category_id = c.id
       LEFT JOIN mart_store_products sp ON sp.product_id = p.id AND sp.is_available = true
       ${where}
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    return result.rows;
  }

  static async create(data: Partial<MartCategory>): Promise<MartCategory> {
    const id = uuidv4();
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw badRequest('Category name is required');
    const slug = normalizeCategorySlug(data.slug);
    const productPrefix = normalizeProductPrefix(data.productPrefix);

    const existing = await query(`SELECT 1 FROM mart_categories WHERE LOWER(slug) = $1`, [slug]);
    if (existing.rows.length) throw conflict('Category slug is already used');

    try {
      const result = await query<MartCategory>(
        `INSERT INTO mart_categories (id, name, slug, product_prefix, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, product_prefix as "productPrefix", icon, sort_order as "sortOrder", is_active as "isActive"`,
        [id, name, slug, productPrefix, data.icon || null, data.sortOrder || 0]
      );
      return result.rows[0];
    } catch (err: any) {
      // The check above can lose a race; the unique constraint is the source of truth.
      if (err?.code === '23505') throw conflict('Category slug is already used');
      throw err;
    }
  }

  static async update(id: string, data: Partial<MartCategory>): Promise<MartCategory | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    let slug: string | undefined;
    if (data.slug !== undefined) {
      slug = normalizeCategorySlug(data.slug);
      const duplicate = await query(`SELECT 1 FROM mart_categories WHERE LOWER(slug) = $1 AND id <> $2`, [slug, id]);
      if (duplicate.rows.length) throw conflict('Category slug is already used');
    }

    if (data.name !== undefined) { fields.push(`name = $${i++}`); params.push(data.name); }
    if (slug !== undefined) { fields.push(`slug = $${i++}`); params.push(slug); }
    if (data.productPrefix !== undefined) {
      const productPrefix = normalizeProductPrefix(data.productPrefix);
      const existing = await query<{ productPrefix: string | null; count: string }>(
        `SELECT c.product_prefix as "productPrefix", COUNT(p.id)::TEXT as count
         FROM mart_categories c
         LEFT JOIN mart_products p ON p.category_id = c.id
         WHERE c.id = $1
         GROUP BY c.id`,
        [id]
      );
      const row = existing.rows[0];
      if (row && Number(row.count) > 0 && row.productPrefix !== productPrefix) {
        throw badRequest('Product prefix cannot change after products exist for this category');
      }
      fields.push(`product_prefix = $${i++}`);
      params.push(productPrefix);
    }
    if (data.icon !== undefined) { fields.push(`icon = $${i++}`); params.push(data.icon); }
    if (data.sortOrder !== undefined) { fields.push(`sort_order = $${i++}`); params.push(data.sortOrder); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(data.isActive); }

    if (!fields.length) return null;
    fields.push(`updated_at = NOW()`);
    params.push(id);

    try {
      const result = await query<MartCategory>(
        `UPDATE mart_categories SET ${fields.join(', ')} WHERE id = $${i}
         RETURNING id, name, slug, product_prefix as "productPrefix", icon, sort_order as "sortOrder", is_active as "isActive"`,
        params
      );
      return result.rows[0] || null;
    } catch (err: any) {
      // A concurrent update can pass the duplicate check; the unique index wins.
      if (err?.code === '23505') throw conflict('Category slug is already used');
      throw err;
    }
  }

  static async delete(id: string): Promise<void> {
    await query(`DELETE FROM mart_categories WHERE id = $1`, [id]);
  }
}
