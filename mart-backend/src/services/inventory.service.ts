import { query } from '../database/db';
import { parseSellingUnit } from '../utils/unitConversion';

export class InventoryService {

  static async getStoreInventory(storeId: string) {
    const result = await query(
      `SELECT p.id as "productId", p.name, p.photo_url as "photoUrl",
              sp.unit as "sellingUnit",
              sp.stock_unit as "stockUnit",
              sp.price::float, sp.availability_status as "availabilityStatus",
              sp.stock_quantity::float as "stockQuantity",
              sp.low_stock_threshold::float as "lowStockThreshold",
              c.name as "categoryName"
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       WHERE sp.store_id = $1
       ORDER BY
         CASE
           WHEN sp.stock_quantity IS NOT NULL AND sp.stock_quantity <= 0 THEN 0
           WHEN sp.stock_quantity IS NOT NULL AND sp.low_stock_threshold IS NOT NULL
                AND sp.stock_quantity <= sp.low_stock_threshold THEN 1
           ELSE 2
         END ASC,
         p.name ASC`,
      [storeId]
    );
    return result.rows;
  }

  static async restock(
    productId: string,
    storeId: string,
    qty: number,
    stockUnit: string,
    note: string | null,
    createdBy: string
  ) {
    const cur = await query<{
      stock_quantity: number | null;
      stock_unit: string | null;
      availability_status: string;
    }>(
      `SELECT stock_quantity::float, stock_unit, availability_status
       FROM mart_store_products WHERE product_id = $1 AND store_id = $2`,
      [productId, storeId]
    );
    if (!cur.rows[0]) throw new Error('Product not found in this store');

    const current = cur.rows[0].stock_quantity ?? 0;
    if (isNaN(qty) || !isFinite(qty)) throw new Error('Invalid quantity');
    const effectiveStockUnit = stockUnit || cur.rows[0].stock_unit || 'kg';
    const newQty = Math.max(0, current + qty);
    const isReduction = qty < 0;

    // Flip status based on direction
    let newStatus = cur.rows[0].availability_status;
    if (!isReduction && newStatus === 'out_of_stock' && newQty > 0) {
      newStatus = 'available'; // restocked — bring back online
    } else if (isReduction && newQty <= 0) {
      newStatus = 'out_of_stock'; // reduced to zero — mark out of stock
    }

    await query(
      `UPDATE mart_store_products
       SET stock_quantity = $1, stock_unit = $2, availability_status = $3,
           is_available = $4, updated_at = NOW()
       WHERE product_id = $5 AND store_id = $6`,
      [newQty, effectiveStockUnit, newStatus, newStatus === 'available', productId, storeId]
    );

    await query(
      `INSERT INTO mart_inventory_log
         (product_id, store_id, change_qty, reason, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, storeId, qty, qty < 0 ? 'manual_correction' : 'restock', note || null, createdBy]
    );

    return { productId, storeId, previousQty: current, newQty, stockUnit };
  }

  static async deductForOrder(
    orderId: string,
    storeId: string,
    items: Array<{ productId: string; quantity: number; sellingUnit: string }>,
    autoOutOfStock: boolean,
    lowStockThreshold: number
  ) {
    const results = [];

    for (const item of items) {
      const cur = await query<{
        stock_quantity: number | null;
        stock_unit: string | null;
        low_stock_threshold: number | null;
        availability_status: string;
      }>(
        `SELECT stock_quantity::float, stock_unit, low_stock_threshold::float, availability_status
         FROM mart_store_products WHERE product_id = $1 AND store_id = $2`,
        [item.productId, storeId]
      );
      const row = cur.rows[0];
      if (!row || row.stock_quantity === null || !row.stock_unit) continue;

      // Convert selling unit to base unit deduction
      const { deductionPerQty, baseUnit } = parseSellingUnit(item.sellingUnit);

      // Only deduct if base units match
      if (baseUnit !== row.stock_unit) continue;

      const deduction = deductionPerQty * item.quantity;
      const newQty = Math.max(0, row.stock_quantity - deduction);
      const threshold = row.low_stock_threshold ?? lowStockThreshold;
      const wentOutOfStock = autoOutOfStock && newQty <= 0;
      const isLow = newQty > 0 && newQty <= threshold;
      const newStatus = wentOutOfStock ? 'out_of_stock' : row.availability_status;

      await query(
        `UPDATE mart_store_products
         SET stock_quantity = $1, availability_status = $2, is_available = $3, updated_at = NOW()
         WHERE product_id = $4 AND store_id = $5`,
        [newQty, newStatus, newStatus === 'available', item.productId, storeId]
      );

      await query(
        `INSERT INTO mart_inventory_log
           (product_id, store_id, change_qty, reason, reference_id)
         VALUES ($1, $2, $3, 'order_deducted', $4)`,
        [item.productId, storeId, -deduction, orderId]
      );

      results.push({ productId: item.productId, newQty, wentOutOfStock, isLow });
    }

    return results;
  }

  static async getHistory(productId: string, storeId: string) {
    const result = await query(
      `SELECT l.id, l.change_qty::float as "changeQty", l.reason,
              l.reference_id as "referenceId", l.note,
              l.created_at as "createdAt",
              a.name as "createdByName", a.username as "createdByUsername",
              o.order_number as "orderNumber",
              sp.stock_unit as "stockUnit"
       FROM mart_inventory_log l
       LEFT JOIN mart_admins a ON a.id = l.created_by
       LEFT JOIN mart_orders o ON o.id = l.reference_id
       LEFT JOIN mart_store_products sp ON sp.product_id = l.product_id AND sp.store_id = l.store_id
       WHERE l.product_id = $1 AND l.store_id = $2
       ORDER BY l.created_at DESC
       LIMIT 100`,
      [productId, storeId]
    );
    return result.rows;
  }

  static async bulkRestock(
    storeId: string,
    items: Array<{ productId: string; qty: number; stockUnit: string }>,
    note: string | null,
    createdBy: string
  ) {
    const results = [];
    for (const item of items) {
      if (!item.qty || item.qty === 0 || isNaN(item.qty)) continue;
      const result = await this.restock(item.productId, storeId, item.qty, item.stockUnit, note, createdBy);
      results.push(result);
    }
    return results;
  }

  static async setStock(
    productId: string,
    storeId: string,
    qty: number,
    stockUnit: string,
    createdBy: string
  ) {
    const cur = await query<{ stock_quantity: number | null }>(
      `SELECT stock_quantity::float FROM mart_store_products WHERE product_id = $1 AND store_id = $2`,
      [productId, storeId]
    );
    const previous = cur.rows[0]?.stock_quantity ?? null;
    const diff = qty - (previous ?? 0);

    await query(
      `UPDATE mart_store_products
       SET stock_quantity = $1, stock_unit = $2, updated_at = NOW()
       WHERE product_id = $3 AND store_id = $4`,
      [qty, stockUnit, productId, storeId]
    );

    await query(
      `INSERT INTO mart_inventory_log
         (product_id, store_id, change_qty, reason, note, created_by)
       VALUES ($1, $2, $3, 'manual_correction', 'Stock set manually', $4)`,
      [productId, storeId, diff, createdBy]
    );

    return { productId, storeId, previousQty: previous, newQty: qty, stockUnit };
  }
}
