import { query, transaction } from '../database/db';
import { badRequest, forbidden, notFound, conflict } from '../utils/apiError';
import { parseSellingUnit } from '../utils/unitConversion';

export class InventoryService {

  static async getStoreInventory(storeId: string) {
    const result = await query(
            `SELECT p.id as "productId", p.name, p.local_name as "localName",
              p.search_aliases as "searchAliases", p.photo_url as "photoUrl",
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
    createdBy: string,
    idempotencyKey?: string,
    unitCost?: number | null,
    transactionClient?: any
  ) {
    const run = async (client: any) => {
    if (idempotencyKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
      const prior = await client.query(`SELECT 1 FROM mart_inventory_log WHERE idempotency_key = $1`, [idempotencyKey]);
      if (prior.rows.length) return { productId, storeId, duplicate: true };
    }
    const cur: { rows: Array<{
      stock_quantity: number | null;
      stock_unit: string | null;
      availability_status: string;
    }> } = await client.query(
      `SELECT stock_quantity::float, stock_unit, availability_status
       FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
      [productId, storeId]
    );
    if (!cur.rows[0]) throw notFound('That product is no longer available in this store');

    const current = cur.rows[0].stock_quantity ?? 0;
    if (isNaN(qty) || !isFinite(qty)) throw badRequest('Invalid quantity');
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

    await client.query(
      `UPDATE mart_store_products
       SET stock_quantity = $1, stock_unit = $2, availability_status = $3,
           is_available = $4, updated_at = NOW()
       WHERE product_id = $5 AND store_id = $6`,
      [newQty, effectiveStockUnit, newStatus, newStatus === 'available', productId, storeId]
    );

    await client.query(
      `INSERT INTO mart_inventory_log
         (product_id, store_id, change_qty, reason, note, created_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, storeId, qty, qty < 0 ? 'manual_correction' : 'restock', note || null, createdBy, idempotencyKey || null]
    );
    await client.query(
      `INSERT INTO mart_inventory_movements
         (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance,
          unit, unit_cost, total_cost, reason, remarks, created_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [productId, storeId, qty < 0 ? 'adjustment' : 'restock',
       qty < 0 ? 0 : qty, qty < 0 ? Math.abs(qty) : 0,
       current, newQty, effectiveStockUnit,
       unitCost ?? null, unitCost == null ? null : Number((qty * unitCost).toFixed(2)),
       qty < 0 ? 'manual_correction' : 'restock', note || null, createdBy, idempotencyKey || null]
    );

    return { productId, storeId, previousQty: current, newQty, stockUnit };
    };
    return transactionClient ? run(transactionClient) : transaction(run);
  }

  static async deductForOrder(
    orderId: string,
    storeId: string,
    items: Array<{ productId: string; quantity: number; sellingUnit: string; storeId?: string | null }>,
    autoOutOfStock: boolean,
    lowStockThreshold: number,
    transactionClient?: any,
    deductionReferenceId: string = orderId,
  ) {
    const deduct = async (client: any) => {
    const results = [];

    for (const item of items) {
      // Multi-store zone: each line is deducted against the store that lists
      // it (item.storeId), falling back to the order's store for legacy rows
      // that predate per-line store attribution.
      const lineStoreId = item.storeId || storeId;
      const alreadyDeducted = await client.query(
        `SELECT 1 FROM mart_inventory_log WHERE product_id = $1 AND store_id = $2 AND reference_id = $3 AND reason = 'order_deducted'`,
        [item.productId, lineStoreId, deductionReferenceId]
      );
      if (alreadyDeducted.rows.length) continue;
      const cur: { rows: Array<{
        stock_quantity: number | null;
        stock_unit: string | null;
        low_stock_threshold: number | null;
        availability_status: string;
        name: string;
      }> } = await client.query(
        `SELECT sp.stock_quantity::float, sp.stock_unit, sp.low_stock_threshold::float, sp.availability_status,
                p.name
         FROM mart_store_products sp
         JOIN mart_products p ON p.id = sp.product_id
         WHERE sp.product_id = $1 AND sp.store_id = $2 FOR UPDATE OF sp`,
        [item.productId, lineStoreId]
      );
      const row = cur.rows[0];
      if (!row || row.stock_quantity === null || !row.stock_unit) continue;

      // Convert selling unit to base unit deduction
      const { deductionPerQty, baseUnit } = parseSellingUnit(item.sellingUnit);

      // Skip products whose selling unit doesn't match the unit its stock is
      // held in — deliveries must never fail over a data misconfiguration, and
      // restock() now blocks such mismatches from being created/newly tracked.
      if (baseUnit !== row.stock_unit) continue;

      const deduction = deductionPerQty * item.quantity;
      const newQty = Math.max(0, row.stock_quantity - deduction);
      const threshold = row.low_stock_threshold ?? lowStockThreshold;
      const wentOutOfStock = autoOutOfStock && newQty <= 0;
      const isLow = newQty > 0 && newQty <= threshold;
      const newStatus = wentOutOfStock ? 'out_of_stock' : row.availability_status;

      const batches = (await client.query(
        `SELECT id, quantity_remaining::float, unit_cost::float
           FROM mart_purchase_batches
          WHERE store_id = $1 AND product_id = $2 AND status = 'active' AND quantity_remaining > 0
          ORDER BY received_at ASC, id ASC
          FOR UPDATE`,
        [lineStoreId, item.productId]
      )).rows;
      let remainingToConsume = deduction;
      let totalCost = 0;
      let firstBatchId: string | null = null;
      for (const batch of batches) {
        if (remainingToConsume <= 0) break;
        const consumed = Math.min(Number(batch.quantity_remaining), remainingToConsume);
        totalCost += consumed * Number(batch.unit_cost);
        remainingToConsume -= consumed;
        await client.query(
          `UPDATE mart_purchase_batches
              SET quantity_remaining = quantity_remaining - $1,
                  status = CASE WHEN quantity_remaining - $1 <= 0 THEN 'exhausted' ELSE status END
            WHERE id = $2`,
          [consumed, batch.id]
        );
        if (!firstBatchId) firstBatchId = batch.id;
      }
      if (remainingToConsume > 0) {
        const fallbackBatch = (await client.query(
          `SELECT unit_cost::float FROM mart_purchase_batches WHERE store_id = $1 AND product_id = $2 ORDER BY received_at DESC, id DESC LIMIT 1`,
          [lineStoreId, item.productId]
        )).rows[0];
        totalCost += remainingToConsume * Number(fallbackBatch?.unit_cost ?? 0);
      }
      const unitCost = deduction > 0 ? totalCost / deduction : 0;

      await client.query(
        `UPDATE mart_store_products
         SET stock_quantity = $1, availability_status = $2, is_available = $3, updated_at = NOW()
         WHERE product_id = $4 AND store_id = $5`,
        [newQty, newStatus, newStatus === 'available', item.productId, lineStoreId]
      );

      await client.query(
        `INSERT INTO mart_inventory_log
           (product_id, store_id, change_qty, reason, reference_id)
         VALUES ($1, $2, $3, 'order_deducted', $4)`,
        [item.productId, lineStoreId, -deduction, deductionReferenceId]
      );

      await client.query(
        `INSERT INTO mart_inventory_movements
           (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance,
            unit, unit_cost, total_cost, source_type, source_id, batch_id, reason)
         VALUES ($1, $2, 'sale', 0, $3, $4, $5, $6, $7, $8, 'order', $9, $10, 'order_deducted')`,
        [item.productId, lineStoreId, deduction, row.stock_quantity, newQty, baseUnit, unitCost, totalCost, deductionReferenceId, firstBatchId]
      );

      results.push({ productId: item.productId, newQty, wentOutOfStock, isLow });
    }

    return results;
    };
    return transactionClient ? deduct(transactionClient) : transaction(deduct);
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
    createdBy: string,
    idempotencyKey?: string
  ) {
    const results = [];
    for (const item of items) {
      if (!item.qty || item.qty === 0 || isNaN(item.qty)) continue;
      const result = await this.restock(item.productId, storeId, item.qty, item.stockUnit, note, createdBy, idempotencyKey ? `${idempotencyKey}:${item.productId}` : undefined);
      results.push(result);
    }
    return results;
  }

  static async receivePurchase(
    storeId: string,
    productId: string,
    quantity: number,
    unit: string,
    unitCost: number,
    createdBy: string,
    note: string | null = null,
    idempotencyKey?: string
  ) {
    return transaction(async (client) => {
      if (idempotencyKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
        const prior = await client.query(`SELECT 1 FROM mart_inventory_log WHERE idempotency_key = $1`, [idempotencyKey]);
        if (prior.rows.length) return { productId, storeId, duplicate: true };
      }
      const receipt = await client.query(
        `INSERT INTO mart_purchase_receipts (store_id, total_cost, created_by, notes)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [storeId, Number((quantity * unitCost).toFixed(2)), createdBy, note]
      );
      const receiptId = receipt.rows[0].id;
      const batch = await client.query(
        `INSERT INTO mart_purchase_batches
           (store_id, product_id, quantity_received, quantity_remaining, unit, unit_cost, received_at)
         VALUES ($1, $2, $3, $3, $4, $5, NOW()) RETURNING id`,
        [storeId, productId, quantity, unit, unitCost]
      );
      const batchId = batch.rows[0].id;
      await client.query(
        `INSERT INTO mart_purchase_receipt_lines
           (receipt_id, product_id, batch_id, quantity, unit, unit_cost, total_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [receiptId, productId, batchId, quantity, unit, unitCost, Number((quantity * unitCost).toFixed(2))]
      );
      await client.query(`UPDATE mart_purchase_receipt_lines SET batch_id = $1 WHERE receipt_id = $2 AND product_id = $3`, [batchId, receiptId, productId]);

      const restockResult = await this.restock(productId, storeId, quantity, unit, note, createdBy, idempotencyKey, unitCost, client);
      return { ...restockResult, receiptId, batchId, unitCost };
    });
  }

  static async setStock(
    productId: string,
    storeId: string,
    qty: number,
    stockUnit: string,
    createdBy: string,
    idempotencyKey?: string
  ) {
    return transaction(async (client) => {
    if (idempotencyKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
      const prior = await client.query(`SELECT 1 FROM mart_inventory_log WHERE idempotency_key = $1`, [idempotencyKey]);
      if (prior.rows.length) return { productId, storeId, duplicate: true };
    }
    const cur = await client.query(
      `SELECT stock_quantity::float FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
      [productId, storeId]
    );
    const previous = cur.rows[0]?.stock_quantity ?? null;
    const diff = qty - (previous ?? 0);

    await client.query(
      `UPDATE mart_store_products
       SET stock_quantity = $1, stock_unit = $2, updated_at = NOW()
       WHERE product_id = $3 AND store_id = $4`,
      [qty, stockUnit, productId, storeId]
    );

    await client.query(
      `INSERT INTO mart_inventory_log
         (product_id, store_id, change_qty, reason, note, created_by, idempotency_key)
       VALUES ($1, $2, $3, 'manual_correction', 'Stock set manually', $4, $5)`,
      [productId, storeId, diff, createdBy, idempotencyKey || null]
    );

    const movementIn = diff > 0 ? diff : 0;
    const movementOut = diff < 0 ? Math.abs(diff) : 0;
    await client.query(
      `INSERT INTO mart_inventory_movements
         (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance,
          unit, reason, remarks, created_by, idempotency_key)
       VALUES ($1, $2, 'adjustment', $3, $4, $5, $6, $7, 'manual_correction', 'Stock set manually', $8, $9)`,
      [productId, storeId, movementIn, movementOut, previous, qty, stockUnit, createdBy, idempotencyKey || null]
    );

    return { productId, storeId, previousQty: previous, newQty: qty, stockUnit };
    });
  }

  static async reserveForOrder(
    orderId: string,
    storeId: string,
    items: Array<{ productId: string; quantity: number; sellingUnit: string; storeId?: string | null }>,
    transactionClient?: any
  ) {
    const run = async (client: any) => {
      const existing = await client.query(`SELECT 1 FROM mart_stock_reservations WHERE order_id = $1`, [orderId]);
      if (existing.rows.length) return { duplicate: true };
      for (const item of items) {
        const lineStoreId = item.storeId || storeId;
        const { deductionPerQty, baseUnit } = parseSellingUnit(item.sellingUnit);
        const stockRow = (await client.query(
          `SELECT stock_unit FROM mart_store_products WHERE product_id = $1 AND store_id = $2`,
          [item.productId, lineStoreId]
        )).rows[0];
        if (!stockRow || stockRow.stock_unit !== baseUnit) continue;
        const quantity = deductionPerQty * item.quantity;
        await client.query(
          `INSERT INTO mart_stock_reservations (order_id, product_id, store_id, quantity, status)
           VALUES ($1, $2, $3, $4, 'reserved')
           ON CONFLICT (order_id, product_id, store_id) DO NOTHING`,
          [orderId, item.productId, lineStoreId, quantity]
        );
        await client.query(
          `UPDATE mart_store_products SET reserved_stock = reserved_stock + $1, updated_at = NOW()
           WHERE product_id = $2 AND store_id = $3`,
          [quantity, item.productId, lineStoreId]
        );
      }
      return { reserved: true };
    };
    return transactionClient ? run(transactionClient) : transaction(run);
  }

  static async releaseForOrder(orderId: string, transactionClient?: any) {
    const run = async (client: any) => {
      const reservations = (await client.query(
        `SELECT product_id, store_id, quantity FROM mart_stock_reservations WHERE order_id = $1 AND status = 'reserved'`,
        [orderId]
      )).rows;
      for (const reservation of reservations) {
        await client.query(
          `UPDATE mart_store_products SET reserved_stock = GREATEST(0, reserved_stock - $1), updated_at = NOW()
           WHERE product_id = $2 AND store_id = $3`,
          [reservation.quantity, reservation.product_id, reservation.store_id]
        );
      }
      await client.query(`UPDATE mart_stock_reservations SET status = 'released', updated_at = NOW() WHERE order_id = $1 AND status = 'reserved'`, [orderId]);
      return { released: reservations.length };
    };
    return transactionClient ? run(transactionClient) : transaction(run);
  }

  static async consumeForOrder(orderId: string, transactionClient?: any) {
    const run = async (client: any) => {
      const reservations = (await client.query(
        `SELECT product_id, store_id, quantity FROM mart_stock_reservations WHERE order_id = $1 AND status = 'reserved'`,
        [orderId]
      )).rows;
      for (const reservation of reservations) {
        await client.query(
          `UPDATE mart_store_products SET reserved_stock = GREATEST(0, reserved_stock - $1), updated_at = NOW()
           WHERE product_id = $2 AND store_id = $3`,
          [reservation.quantity, reservation.product_id, reservation.store_id]
        );
      }
      await client.query(`UPDATE mart_stock_reservations SET status = 'consumed', updated_at = NOW() WHERE order_id = $1 AND status = 'reserved'`, [orderId]);
      return { consumed: reservations.length };
    };
    return transactionClient ? run(transactionClient) : transaction(run);
  }
}
