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
              p.is_bundle as "isBundle",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'productId', bc.component_product_id,
                  'name', p2.name,
                  'quantity', bc.quantity,
                  'unit', bc.deduction_unit,
                  'price', sp2.price
                ))
                FROM mart_bundle_components bc
                JOIN mart_store_products sp2 ON sp2.store_id = bc.store_id AND sp2.product_id = bc.component_product_id
                JOIN mart_products p2 ON p2.id = bc.component_product_id
                WHERE bc.store_id = sp.store_id AND bc.bundle_product_id = p.id
              ), '[]'::json) as "comboComponents",
              c.name as "categoryName",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'changeQty', l.change_qty::float,
                  'note', l.note,
                  'createdBy', l.name,
                  'createdByUsername', l.username,
                  'createdAt', l.created_at
                ) ORDER BY l.created_at DESC)
                FROM (
                  SELECT l.change_qty, l.note, l.created_at, a.name, a.username
                    FROM mart_inventory_log l
                   LEFT JOIN mart_admins a ON a.id = l.created_by
                   WHERE l.product_id = sp.product_id AND l.store_id = sp.store_id AND l.reason = 'restock'
                   ORDER BY l.created_at DESC
                   LIMIT 2
                ) l
              ), '[]'::json) as "recentRestocks"
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
    createdBy: string | null,
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

      results.push({ productId: item.productId, newQty, wentOutOfStock, isLow, totalCost, unitCost });
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
    createdBy: string | null,
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

  static async adjustStock(
    productId: string,
    storeId: string,
    qty: number,
    reason: string,
    note: string | null,
    createdBy: string | null,
    idempotencyKey?: string
  ) {
    return transaction(async (client) => {
      if (idempotencyKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
        const prior = await client.query(`SELECT 1 FROM mart_inventory_log WHERE idempotency_key = $1`, [idempotencyKey]);
        if (prior.rows.length) return { productId, storeId, duplicate: true };
      }
      const cur = (await client.query(
        `SELECT stock_quantity::float, stock_unit, availability_status
           FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
        [productId, storeId]
      )).rows[0];
      if (!cur) throw notFound('That product is no longer available in this store');
      const current = cur.stock_quantity ?? 0;
      const newQty = Math.max(0, current + qty);
      const movementType = ['damage','spoiled','expired','lost','missing'].includes(reason) ? 'damage' : 'adjustment';
      const newStatus = newQty <= 0 ? 'out_of_stock' : cur.availability_status;
      await client.query(
        `UPDATE mart_store_products
            SET stock_quantity = $1, availability_status = $2, is_available = $3, updated_at = NOW()
          WHERE product_id = $4 AND store_id = $5`,
        [newQty, newStatus, newStatus === 'available', productId, storeId]
      );
      await client.query(
        `INSERT INTO mart_inventory_log (product_id, store_id, change_qty, reason, note, created_by, idempotency_key)
         VALUES ($1, $2, $3, 'manual_correction', $4, $5, $6)`,
        [productId, storeId, qty, note || reason, createdBy, idempotencyKey || null]
      );
      await client.query(
        `INSERT INTO mart_inventory_movements
           (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance,
            unit, reason, remarks, created_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [productId, storeId, movementType, qty > 0 ? qty : 0, qty < 0 ? Math.abs(qty) : 0,
         current, newQty, cur.stock_unit, reason, note, createdBy, idempotencyKey || null]
      );
      await client.query(
        `INSERT INTO mart_stock_adjustments (store_id, product_id, quantity, reason, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [storeId, productId, qty, reason, note, createdBy]
      );
      return { productId, storeId, previousQty: current, newQty, stockUnit: cur.stock_unit };
    });
  }

  static async createTransfer(
    sourceStoreId: string,
    destinationStoreId: string,
    items: Array<{ productId: string; quantity: number; unit: string }>,
    createdBy: string | null,
    notes: string | null = null,
    idempotencyKey?: string
  ) {
    if (sourceStoreId === destinationStoreId) throw badRequest('Source and destination stores must differ');
    return transaction(async (client) => {
      if (idempotencyKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
      }
      const transfer = (await client.query(
        `INSERT INTO mart_stock_transfers (source_store_id, destination_store_id, notes, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [sourceStoreId, destinationStoreId, notes, createdBy]
      )).rows[0];
      const transferId = transfer.id;

      for (const item of items) {
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw badRequest('Transfer quantity must be positive');
        const sourceRow = (await client.query(
          `SELECT stock_quantity::float, stock_unit, availability_status
             FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
          [item.productId, sourceStoreId]
        )).rows[0];
        if (!sourceRow) throw notFound('Product is not listed in the source store');
        if (sourceRow.stock_unit !== item.unit) throw badRequest('Transfer unit must match source stock unit');
        if (sourceRow.stock_quantity !== null && sourceRow.stock_quantity < item.quantity) {
          throw badRequest('Insufficient stock for transfer');
        }
        const newQty = sourceRow.stock_quantity === null ? null : Number((sourceRow.stock_quantity - item.quantity).toFixed(3));
        if (newQty !== null) {
          await client.query(
            `UPDATE mart_store_products SET stock_quantity = $1, updated_at = NOW() WHERE product_id = $2 AND store_id = $3`,
            [newQty, item.productId, sourceStoreId]
          );
        }
        await client.query(
          `INSERT INTO mart_inventory_movements
             (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance, unit, source_type, source_id, reason)
           VALUES ($1, $2, 'transfer_out', 0, $3, $4, $5, $6, 'transfer', $7, 'store_transfer')`,
          [item.productId, sourceStoreId, item.quantity, sourceRow.stock_quantity, newQty, item.unit, transferId]
        );
        await client.query(
          `INSERT INTO mart_stock_transfer_lines (transfer_id, product_id, quantity, unit, in_transit_quantity, status)
           VALUES ($1, $2, $3, $4, $3, 'in_transit')`,
          [transferId, item.productId, item.quantity, item.unit]
        );
      }
      return { transferId, status: 'in_transit' };
    });
  }

  static async receiveTransfer(
    transferId: string,
    lines: Array<{ lineId: string; receivedQuantity: number }>,
    receivedBy: string | null
  ) {
    return transaction(async (client) => {
      const transfer = (await client.query(
        `SELECT id, source_store_id, destination_store_id, status FROM mart_stock_transfers WHERE id = $1 FOR UPDATE`,
        [transferId]
      )).rows[0];
      if (!transfer) throw notFound('Transfer not found');
      if (transfer.status === 'cancelled') throw badRequest('Transfer is cancelled');

      let partial = false;
      for (const input of lines) {
        const line = (await client.query(
          `SELECT id, product_id, quantity, unit, in_transit_quantity, received_quantity
             FROM mart_stock_transfer_lines WHERE id = $1 AND transfer_id = $2 FOR UPDATE`,
          [input.lineId, transferId]
        )).rows[0];
        if (!line) throw notFound('Transfer line not found');
        const received = Number(input.receivedQuantity);
        if (!Number.isFinite(received) || received < 0 || received > Number(line.in_transit_quantity)) {
          throw badRequest('Invalid received quantity');
        }
        if (received === 0) { partial = true; continue; }

        // Ensure destination listing exists.
        const destRow = (await client.query(
          `SELECT stock_quantity::float, stock_unit FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
          [line.product_id, transfer.destination_store_id]
        )).rows[0];
        if (!destRow) {
          await client.query(
            `INSERT INTO mart_store_products (product_id, store_id, stock_quantity, stock_unit, availability_status, is_available, price, unit)
             SELECT $1, $2, 0, $3, 'available', true, sp.price, sp.unit
               FROM mart_store_products sp
              WHERE sp.product_id = $1 AND sp.store_id = $3
             ON CONFLICT DO NOTHING`,
            [line.product_id, transfer.destination_store_id, line.unit, transfer.source_store_id]
          );
        }
        const destCurrent = destRow?.stock_quantity ?? 0;
        const destNew = Number((destCurrent + received).toFixed(3));
        await client.query(
          `UPDATE mart_store_products SET stock_quantity = $1, stock_unit = COALESCE(stock_unit, $2), updated_at = NOW()
           WHERE product_id = $3 AND store_id = $4`,
          [destNew, line.unit, line.product_id, transfer.destination_store_id]
        );
        await client.query(
          `INSERT INTO mart_inventory_movements
             (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance, unit, source_type, source_id, reason)
           VALUES ($1, $2, 'transfer_in', $3, 0, $4, $5, $6, 'transfer', $7, 'store_transfer')`,
          [line.product_id, transfer.destination_store_id, received, destCurrent, destNew, line.unit, transferId]
        );
        const newInTransit = Number((Number(line.in_transit_quantity) - received).toFixed(3));
        await client.query(
          `UPDATE mart_stock_transfer_lines
              SET in_transit_quantity = $1, received_quantity = received_quantity + $2,
                  status = CASE WHEN $1 <= 0 THEN 'received' ELSE 'partial' END, updated_at = NOW()
            WHERE id = $3`,
          [newInTransit, received, line.id]
        );
        if (newInTransit > 0) partial = true;
      }

      const allLines = (await client.query(
        `SELECT in_transit_quantity FROM mart_stock_transfer_lines WHERE transfer_id = $1`,
        [transferId]
      )).rows;
      const anyInTransit = allLines.some((row: any) => Number(row.in_transit_quantity) > 0);
      const newStatus = anyInTransit ? 'partial' : 'received';
      await client.query(
        `UPDATE mart_stock_transfers SET status = $1, received_by = $2, updated_at = NOW() WHERE id = $3`,
        [newStatus, receivedBy, transferId]
      );
      return { transferId, status: newStatus, partial: anyInTransit };
    });
  }

  static async recordCustomerReturn(
    orderId: string,
    productId: string,
    storeId: string,
    quantity: number,
    unit: string,
    condition: 'resalable' | 'damaged',
    createdBy: string | null,
    note: string | null = null,
    idempotencyKey?: string
  ) {
    return transaction(async (client) => {
      if (idempotencyKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
        const prior = await client.query(`SELECT 1 FROM mart_inventory_log WHERE idempotency_key = $1`, [idempotencyKey]);
        if (prior.rows.length) return { duplicate: true };
      }
      const saleMovement = (await client.query(
        `SELECT unit_cost::float FROM mart_inventory_movements
          WHERE source_type = 'order' AND source_id = $1 AND product_id = $2 AND movement_type = 'sale'
          ORDER BY created_at DESC LIMIT 1`,
        [orderId, productId]
      )).rows[0];
      const unitCost = saleMovement?.unit_cost ?? null;

      if (condition === 'resalable') {
        const cur = (await client.query(
          `SELECT stock_quantity::float, stock_unit, availability_status
             FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
          [productId, storeId]
        )).rows[0];
        if (!cur) throw notFound('That product is no longer available in this store');
        const current = cur.stock_quantity ?? 0;
        const newQty = Number((current + quantity).toFixed(3));
        await client.query(
          `UPDATE mart_store_products SET stock_quantity = $1, updated_at = NOW() WHERE product_id = $2 AND store_id = $3`,
          [newQty, productId, storeId]
        );
        await client.query(
          `INSERT INTO mart_inventory_log (product_id, store_id, change_qty, reason, reference_id, note, created_by, idempotency_key)
           VALUES ($1, $2, $3, 'restock', $4, $5, $6, $7)`,
          [productId, storeId, quantity, orderId, note || 'Customer return (resalable)', createdBy, idempotencyKey || null]
        );
        await client.query(
          `INSERT INTO mart_inventory_movements
             (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance, unit, unit_cost, source_type, source_id, reason, remarks, created_by, idempotency_key)
           VALUES ($1, $2, 'return_in', $3, 0, $4, $5, $6, $7, 'order', $8, 'customer_return', $9, $10, $11)`,
          [productId, storeId, quantity, current, newQty, unit, unitCost, orderId, note, createdBy, idempotencyKey || null]
        );
      }
      return { productId, storeId, quantity, condition };
    });
  }

  static async recordSupplierReturn(
    productId: string,
    storeId: string,
    quantity: number,
    unit: string,
    unitCost: number | null,
    createdBy: string | null,
    note: string | null = null,
    idempotencyKey?: string
  ) {
    return transaction(async (client) => {
      if (idempotencyKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
        const prior = await client.query(`SELECT 1 FROM mart_inventory_log WHERE idempotency_key = $1`, [idempotencyKey]);
        if (prior.rows.length) return { productId, storeId, duplicate: true };
      }
      const cur = (await client.query(
        `SELECT stock_quantity::float, stock_unit FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
        [productId, storeId]
      )).rows[0];
      if (!cur) throw notFound('That product is no longer available in this store');
      const current = cur.stock_quantity ?? 0;
      const newQty = Math.max(0, Number((current - quantity).toFixed(3)));
      await client.query(
        `UPDATE mart_store_products SET stock_quantity = $1, updated_at = NOW() WHERE product_id = $2 AND store_id = $3`,
        [newQty, productId, storeId]
      );
      await client.query(
        `INSERT INTO mart_inventory_log (product_id, store_id, change_qty, reason, note, created_by, idempotency_key)
         VALUES ($1, $2, $3, 'manual_correction', $4, $5, $6)`,
        [productId, storeId, -quantity, note || 'Supplier return', createdBy, idempotencyKey || null]
      );
      await client.query(
        `INSERT INTO mart_inventory_movements
           (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance, unit, unit_cost, source_type, reason, remarks, created_by, idempotency_key)
         VALUES ($1, $2, 'return_out', 0, $3, $4, $5, $6, $7, 'supplier', 'supplier_return', $8, $9, $10)`,
        [productId, storeId, quantity, current, newQty, unit, unitCost, note, createdBy, idempotencyKey || null]
      );
      return { productId, storeId, previousQty: current, newQty };
    });
  }

  static async reconcileStock(
    storeId: string,
    items: Array<{ productId: string; countedQuantity: number; unit: string }>,
    createdBy: string | null,
    note: string | null = null,
    idempotencyKey?: string
  ) {
    return transaction(async (client) => {
      if (idempotencyKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);
      }
      const results = [];
      for (const item of items) {
        const cur = (await client.query(
          `SELECT stock_quantity::float, stock_unit FROM mart_store_products WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
          [item.productId, storeId]
        )).rows[0];
        if (!cur) throw notFound('That product is no longer available in this store');
        const current = cur.stock_quantity ?? 0;
        const variance = Number((item.countedQuantity - current).toFixed(3));
        if (variance === 0) { results.push({ productId: item.productId, variance: 0, newQty: current }); continue; }
        await client.query(
          `UPDATE mart_store_products SET stock_quantity = $1, updated_at = NOW() WHERE product_id = $2 AND store_id = $3`,
          [item.countedQuantity, item.productId, storeId]
        );
        await client.query(
          `INSERT INTO mart_inventory_log (product_id, store_id, change_qty, reason, note, created_by, idempotency_key)
           VALUES ($1, $2, $3, 'manual_correction', $4, $5, $6)`,
          [item.productId, storeId, variance, note || 'Stocktake reconciliation', createdBy, idempotencyKey || null]
        );
        await client.query(
          `INSERT INTO mart_inventory_movements
             (product_id, store_id, movement_type, quantity_in, quantity_out, previous_balance, new_balance, unit, source_type, reason, remarks, created_by, idempotency_key)
           VALUES ($1, $2, 'reconciliation', $3, $4, $5, $6, $7, 'stocktake', 'stocktake', $8, $9, $10)`,
          [item.productId, storeId, variance > 0 ? variance : 0, variance < 0 ? Math.abs(variance) : 0, current, item.countedQuantity, item.unit, note, createdBy, idempotencyKey || null]
        );
        results.push({ productId: item.productId, variance, newQty: item.countedQuantity });
      }
      return { reconciled: results.length, results };
    });
  }
}
