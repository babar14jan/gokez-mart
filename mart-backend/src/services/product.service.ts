import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export interface MartProduct {
  id: string;
  categoryId: string | null;
  categoryName?: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  price: number;
  unit: string;
  weightOptions: Array<{ label: string; price: number }> | null;
  discountPercent: number;
  isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.category_id as "categoryId", c.name as "categoryName",
         p.name, p.description, p.photo_url as "photoUrl",
         p.weight_options as "weightOptions",
         sp.price::float, sp.unit,
         sp.discount_percent::float as "discountPercent",
         sp.is_available as "isAvailable",
         sp.availability_status as "availabilityStatus",
         sp.sort_order as "sortOrder",
         p.created_at as "createdAt", p.updated_at as "updatedAt"
  FROM mart_products p
  JOIN mart_store_products sp ON sp.product_id = p.id
  LEFT JOIN mart_categories c ON c.id = p.category_id
`;

export class ProductService {
  static async findAll(filters?: {
    storeId?: string;
    categoryId?: string;
    available?: boolean;
    excludeHidden?: boolean;
  }): Promise<MartProduct[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters?.storeId) {
      conditions.push(`sp.store_id = $${i++}`);
      params.push(filters.storeId);
    }
    if (filters?.categoryId) {
      conditions.push(`p.category_id = $${i++}`);
      params.push(filters.categoryId);
    }
    if (filters?.available !== undefined) {
      conditions.push(`sp.is_available = $${i++}`);
      params.push(filters.available);
    }
    if (filters?.excludeHidden) {
      conditions.push(`sp.availability_status != 'hidden'`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query<MartProduct>(
      `${PRODUCT_SELECT}
       ${where}
       ORDER BY
         CASE WHEN sp.availability_status = 'out_of_stock' THEN 1 ELSE 0 END ASC,
         sp.sort_order ASC, p.name ASC`,
      params
    );
    return result.rows;
  }

  static async findById(id: string, storeId?: string): Promise<MartProduct | null> {
    const conditions = [`p.id = $1`];
    const params: unknown[] = [id];
    if (storeId) { conditions.push(`sp.store_id = $2`); params.push(storeId); }
    const result = await query<MartProduct>(
      `${PRODUCT_SELECT} WHERE ${conditions.join(' AND ')}`,
      params
    );
    return result.rows[0] || null;
  }

  // Create global product + store_product entry
  static async create(data: Partial<MartProduct> & { storeId: string }): Promise<MartProduct> {
    const id = uuidv4();
    await query(
      `INSERT INTO mart_products (id, category_id, name, description, photo_url, weight_options)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, data.categoryId || null, data.name, data.description || null,
       data.photoUrl || null, data.weightOptions ? JSON.stringify(data.weightOptions) : null]
    );
    await query(
      `INSERT INTO mart_store_products
         (store_id, product_id, price, unit, discount_percent, availability_status, is_available, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [data.storeId, id, data.price, data.unit || '1 kg',
       data.discountPercent || 0,
       data.availabilityStatus || 'available',
       data.isAvailable !== false,
       data.sortOrder || 0]
    );
    return (await this.findById(id, data.storeId))!;
  }

  // Update: global fields (name, photo, description) + store-specific fields (price, availability)
  static async update(id: string, data: Partial<MartProduct> & { storeId?: string }): Promise<MartProduct | null> {
    // Update global product fields
    const globalFields: string[] = [];
    const globalParams: unknown[] = [];
    let gi = 1;
    if (data.categoryId !== undefined) { globalFields.push(`category_id = $${gi++}`); globalParams.push(data.categoryId); }
    if (data.name !== undefined)       { globalFields.push(`name = $${gi++}`);        globalParams.push(data.name); }
    if (data.description !== undefined){ globalFields.push(`description = $${gi++}`); globalParams.push(data.description); }
    if (data.photoUrl !== undefined)   { globalFields.push(`photo_url = $${gi++}`);   globalParams.push(data.photoUrl); }
    if (data.weightOptions !== undefined){ globalFields.push(`weight_options = $${gi++}`); globalParams.push(JSON.stringify(data.weightOptions)); }
    if (globalFields.length) {
      globalFields.push(`updated_at = NOW()`);
      globalParams.push(id);
      await query(`UPDATE mart_products SET ${globalFields.join(', ')} WHERE id = $${gi}`, globalParams);
    }

    // Update store-specific fields
    if (data.storeId) {
      const storeFields: string[] = [];
      const storeParams: unknown[] = [];
      let si = 1;
      if (data.price !== undefined)           { storeFields.push(`price = $${si++}`);               storeParams.push(data.price); }
      if (data.unit !== undefined)            { storeFields.push(`unit = $${si++}`);                storeParams.push(data.unit); }
      if (data.discountPercent !== undefined) { storeFields.push(`discount_percent = $${si++}`);    storeParams.push(data.discountPercent); }
      if (data.availabilityStatus !== undefined) {
        storeFields.push(`availability_status = $${si++}`); storeParams.push(data.availabilityStatus);
        storeFields.push(`is_available = $${si++}`);        storeParams.push(data.availabilityStatus === 'available');
      } else if (data.isAvailable !== undefined) {
        storeFields.push(`is_available = $${si++}`); storeParams.push(data.isAvailable);
      }
      if (data.sortOrder !== undefined) { storeFields.push(`sort_order = $${si++}`); storeParams.push(data.sortOrder); }
      if (storeFields.length) {
        storeFields.push(`updated_at = NOW()`);
        storeParams.push(data.storeId, id);
        await query(
          `UPDATE mart_store_products SET ${storeFields.join(', ')} WHERE store_id = $${si} AND product_id = $${si + 1}`,
          storeParams
        );
      }
    }

    return this.findById(id, data.storeId);
  }

  static async delete(id: string): Promise<void> {
    // Deletes cascade to mart_store_products via FK
    await query(`DELETE FROM mart_products WHERE id = $1`, [id]);
  }

  // Assign an existing product to a store
  static async assignToStore(productId: string, storeId: string, data: {
    price: number; unit: string; discountPercent?: number;
  }): Promise<void> {
    await query(
      `INSERT INTO mart_store_products (store_id, product_id, price, unit, discount_percent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (store_id, product_id) DO UPDATE SET
         price = EXCLUDED.price, unit = EXCLUDED.unit,
         discount_percent = EXCLUDED.discount_percent, updated_at = NOW()`,
      [storeId, productId, data.price, data.unit, data.discountPercent || 0]
    );
  }
}
