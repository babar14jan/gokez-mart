import { query } from '../database/db';
import { badRequest, notFound } from '../utils/apiError';

// Daily sales ledger. App-side figures are recomputed live from mart_orders
// (never stored), so they stay in sync with the dashboard KPIs. Offline
// counter sales are stored one row per item in mart_offline_sales; the day's
// cash/UPI split is a SUM over those rows so the ledger and the individual
// entries can never disagree.
//
// Statuses excluded from every figure are the terminal "did not result in a
// sale" states — the same set the dashboard KPIs use.

const TERMINAL = "('cancelled','failed_delivery','terminated')";

// IST-calendar-day bounds for a `YYYY-MM-DD` local date, matching how
// buildOrderWindow treats custom dates.
const dayBounds = (date: string, startIndex = 1) => ({
  clause: `o.created_at >= ((${`$${startIndex}`}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
           AND o.created_at < (((${`$${startIndex + 1}`}::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
  params: [date, date],
});

export interface DailySalesDay {
  date: string;
  storeId: string | null;
  // ── App orders (live from delivered mart_orders) ───────────────────────
  ordersDelivered: number;
  ordersCancelled: number;
  subtotalValue: number;    // store fulfillment value before Gokez coupon subsidy (incl. delivery charge)
  couponDeduction: number;  // Gokez-funded campaign/coupon subsidy
  orderValueAfterCoupon: number; // what customers actually pay for app orders
  deliveryCharge: number;   // delivery charges collected from app orders
  codValue: number;
  upiValue: number;
  // ── Offline counter (itemised, mart_offline_sales) ─────────────────────
  offlineCash: number;
  offlineUpi: number;
  offlineTotal: number;
  offlineEntryCount: number;
  // ── Reconciled day total ────────────────────────────────────────────────
  totalDaySales: number;     // store fulfillment value + offlineTotal
  hasManualEntry: boolean;
}

export interface OfflineSale {
  id: string;
  date: string;
  storeId: string;
  productId: string | null;
  productName: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  total: number;
  paymentMethod: 'cash' | 'upi';
  notes: string | null;
  recordedBy: { id: string; username: string; name: string | null } | null;
  createdAt: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

// Future-dates guard, computed in IST like every other day boundary. A future
// day has no sales yet, and allowing it would let staff pre-book numbers the
// store has not collected.
const assertNotFuture = (date: string) => {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
  const picked = new Date(`${date}T00:00:00`);
  if (picked > today) throw badRequest('Future dates cannot be recorded');
};

export class DailySalesService {
  // Full day picture: live app KPIs merged with the itemised offline entries.
  static async getDay(date: string, storeId: string): Promise<DailySalesDay> {
    if (!isDate(date)) throw badRequest('date must be YYYY-MM-DD');

    const { clause, params: dateParams } = dayBounds(date);
    const appParams = [...dateParams, storeId];
    const app = await query<{
      delivered: number; cancelled: number;
      subtotal_value: string | number; coupon_amount: string | number; net_value: string | number; delivery_charge: string | number;
      cod_value: string | number; upi_value: string | number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE o.status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE o.status IN ${TERMINAL})::int AS cancelled,
         COALESCE(SUM(o.subtotal + o.delivery_charge) FILTER (WHERE o.status = 'delivered'), 0)::float AS subtotal_value,
         COALESCE(SUM(o.campaign_discount) FILTER (WHERE o.status = 'delivered'), 0)::float AS coupon_amount,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0)::float AS net_value,
         COALESCE(SUM(o.delivery_charge) FILTER (WHERE o.status = 'delivered'), 0)::float AS delivery_charge,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered' AND o.payment_method = 'cod'), 0)::float AS cod_value,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered' AND o.payment_method IN ('upi','phonepay')), 0)::float AS upi_value
       FROM mart_orders o
       WHERE ${clause} AND o.store_id = $3`,
      appParams
    );

    const a = app.rows[0];
    const netValue = num(a?.net_value);
    const storeFulfillmentValue = num(a?.subtotal_value);
    const offline = await this.offlineTotals(storeId, date);

    return {
      date, storeId,
      ordersDelivered: num(a?.delivered),
      ordersCancelled: num(a?.cancelled),
      subtotalValue: num(a?.subtotal_value),
      couponDeduction: num(a?.coupon_amount),
      orderValueAfterCoupon: netValue,
      deliveryCharge: num(a?.delivery_charge),
      codValue: num(a?.cod_value),
      upiValue: num(a?.upi_value),
      offlineCash: offline.cash,
      offlineUpi: offline.upi,
      offlineTotal: offline.cash + offline.upi,
      offlineEntryCount: offline.count,
      totalDaySales: storeFulfillmentValue + offline.cash + offline.upi,
      hasManualEntry: offline.count > 0,
    };
  }

  // Every day in an IST date range (from/to inclusive), app KPIs merged with
  // offline entries, sorted oldest first. Used by the hub's Yesterday / This
  // Month / All / Custom filters.
  static async getDays(from: string, to: string, storeId: string): Promise<DailySalesDay[]> {
    if (!isDate(from) || !isDate(to)) throw badRequest('from and to must be YYYY-MM-DD');
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (start.getTime() > end.getTime() || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw badRequest('Invalid date range');
    }

    const app = await query<{
      day: string;
      delivered: number; cancelled: number;
      subtotal_value: string | number; coupon_amount: string | number; net_value: string | number; delivery_charge: string | number;
      cod_value: string | number; upi_value: string | number;
    }>(
      `SELECT
         (o.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
         COUNT(*) FILTER (WHERE o.status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE o.status IN ${TERMINAL})::int AS cancelled,
         COALESCE(SUM(o.subtotal + o.delivery_charge) FILTER (WHERE o.status = 'delivered'), 0)::float AS subtotal_value,
         COALESCE(SUM(o.campaign_discount) FILTER (WHERE o.status = 'delivered'), 0)::float AS coupon_amount,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0)::float AS net_value,
         COALESCE(SUM(o.delivery_charge) FILTER (WHERE o.status = 'delivered'), 0)::float AS delivery_charge,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered' AND o.payment_method = 'cod'), 0)::float AS cod_value,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered' AND o.payment_method IN ('upi','phonepay')), 0)::float AS upi_value
       FROM mart_orders o
       WHERE o.store_id = $1
         AND o.created_at >= (($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
         AND o.created_at <  (((($3::date + 1))::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
       GROUP BY 1 ORDER BY 1`,
      [storeId, from, to]
    );

    const offline = await query<{
      day: string; cash: string | number; upi: string | number; entry_count: number;
    }>(
      `SELECT sale_date::text AS day,
              COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash'), 0)::float AS cash,
              COALESCE(SUM(total) FILTER (WHERE payment_method = 'upi'), 0)::float AS upi,
              COUNT(*)::int AS entry_count
         FROM mart_offline_sales
        WHERE store_id = $1 AND sale_date >= $2::date AND sale_date <= $3::date
        GROUP BY 1 ORDER BY 1`,
      [storeId, from, to]
    );

    const days = new Set<string>(app.rows.map(r => String(r.day)));
    offline.rows.forEach(r => days.add(String(r.day)));

    // A ledger shows blank zero rows too, so staff can see gaps in a short
    // range. Do not expand very long ranges (e.g. "All") into one row per
    // calendar day — that would render years of empty rows.
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays <= 62) {
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        days.add(d.toISOString().slice(0, 10));
      }
    }

    const appByDate = new Map(app.rows.map(r => [String(r.day), r]));
    const offlineByDate = new Map(offline.rows.map(r => [String(r.day), r]));
    return [...days].sort().map(date => {
      const a = appByDate.get(date);
      const o = offlineByDate.get(date);
      const netValue = num(a?.net_value);
      const storeFulfillmentValue = num(a?.subtotal_value);
      const offlineCash = num(o?.cash);
      const offlineUpi = num(o?.upi);
      const offlineEntryCount = num(o?.entry_count);
      return {
        date, storeId,
        ordersDelivered: num(a?.delivered),
        ordersCancelled: num(a?.cancelled),
        subtotalValue: num(a?.subtotal_value),
        couponDeduction: num(a?.coupon_amount),
        orderValueAfterCoupon: netValue,
        deliveryCharge: num(a?.delivery_charge),
        codValue: num(a?.cod_value),
        upiValue: num(a?.upi_value),
        offlineCash,
        offlineUpi,
        offlineTotal: offlineCash + offlineUpi,
        offlineEntryCount,
        totalDaySales: storeFulfillmentValue + offlineCash + offlineUpi,
        hasManualEntry: offlineEntryCount > 0,
      } as DailySalesDay;
    });
  }

  private static async offlineTotals(storeId: string, date: string) {
    const { rows } = await query<{ cash: string | number; upi: string | number; entry_count: number }>(
      `SELECT COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash'), 0)::float AS cash,
              COALESCE(SUM(total) FILTER (WHERE payment_method = 'upi'), 0)::float AS upi,
              COUNT(*)::int AS entry_count
         FROM mart_offline_sales
        WHERE store_id = $1 AND sale_date = $2::date`,
      [storeId, date]
    );
    const r = rows[0];
    return { cash: num(r?.cash), upi: num(r?.upi), count: num(r?.entry_count) };
  }

  // All offline counter rows for a day, oldest first.
  static async listEntries(date: string, storeId: string): Promise<OfflineSale[]> {
    if (!isDate(date)) throw badRequest('date must be YYYY-MM-DD');
    const { rows } = await query<{
      id: string; date: string; store_id: string; product_id: string | null;
      product_name: string; unit: string; unit_price: string | number;
      quantity: string | number; total: string | number; payment_method: 'cash' | 'upi';
      notes: string | null; recorded_by: string | null;
      recorded_by_username: string | null; recorded_by_name: string | null;
      created_at: string;
    }>(
      `SELECT e.id,
              e.sale_date::text AS date,
              e.store_id,
              e.product_id,
              e.product_name,
              e.unit,
              e.unit_price::float AS unit_price,
              e.quantity::float AS quantity,
              e.total::float AS total,
              e.payment_method,
              e.notes,
              e.recorded_by,
              a.username AS recorded_by_username,
              NULLIF(a.name, '') AS recorded_by_name,
              e.created_at
         FROM mart_offline_sales e
         LEFT JOIN mart_admins a ON a.id = e.recorded_by
        WHERE e.store_id = $1 AND e.sale_date = $2::date
        ORDER BY e.created_at ASC, e.id ASC`,
      [storeId, date]
    );
    return rows.map(r => ({
      id: r.id,
      date: String(r.date),
      storeId: r.store_id,
      productId: r.product_id,
      productName: r.product_name,
      unit: r.unit,
      unitPrice: num(r.unit_price),
      quantity: num(r.quantity),
      total: num(r.total),
      paymentMethod: r.payment_method,
      notes: r.notes,
      recordedBy: r.recorded_by
        ? {
            id: r.recorded_by,
            username: r.recorded_by_username || r.recorded_by,
            name: r.recorded_by_name,
          }
        : null,
      createdAt: r.created_at,
    }));
  }

  // Add one offline counter row. Price/name/unit are read from the store's
  // listing server-side — the client never supplies a price, so an offline
  // entry always matches what the same item sells for in the app. The
  // effective (discounted) price is used, matching the customer storefront.
  static async addEntry(
    storeId: string,
    date: string,
    productId: string,
    quantity: number,
    paymentMethod: 'cash' | 'upi',
    notes: string | null,
    adminId: string | null
  ): Promise<{ id: string }> {
    if (!isDate(date)) throw badRequest('date must be YYYY-MM-DD');
    assertNotFuture(date);
    if (!productId) throw badRequest('productId is required');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99_999) {
      throw badRequest('Quantity must be greater than 0');
    }
    if (paymentMethod !== 'cash' && paymentMethod !== 'upi') {
      throw badRequest('paymentMethod must be cash or upi');
    }

    const { rows } = await query<{
      id: string; name: string; unit: string; price: string | number; discount_percent: string | number;
    }>(
      `SELECT p.id, p.name, sp.unit, sp.price::float AS price,
              COALESCE(sp.discount_percent, 0)::float AS discount_percent
         FROM mart_store_products sp
         JOIN mart_products p ON p.id = sp.product_id
        WHERE sp.store_id = $1 AND sp.product_id = $2`,
      [storeId, productId]
    );
    const product = rows[0];
    if (!product) throw badRequest('That product is not listed for this store');

    const discount = num(product.discount_percent);
    const unitPrice = discount > 0
      ? Math.round(num(product.price) * (1 - discount / 100))
      : num(product.price);
    const total = round2(unitPrice * quantity);

    const inserted = await query<{ id: string }>(
      `INSERT INTO mart_offline_sales
         (store_id, sale_date, product_id, product_name, unit, unit_price, quantity, total,
          payment_method, notes, recorded_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        storeId, date, product.id, product.name, product.unit,
        unitPrice, quantity, total, paymentMethod, notes ?? null, adminId,
      ]
    );
    return { id: inserted.rows[0].id };
  }

  static async updateEntry(
    id: string,
    storeId: string,
    date: string,
    productId: string,
    quantity: number,
    paymentMethod: 'cash' | 'upi',
    notes: string | null
  ): Promise<{ id: string }> {
    if (!isDate(date)) throw badRequest('date must be YYYY-MM-DD');
    assertNotFuture(date);
    if (!productId) throw badRequest('productId is required');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99_999) {
      throw badRequest('Quantity must be greater than 0');
    }
    if (paymentMethod !== 'cash' && paymentMethod !== 'upi') {
      throw badRequest('paymentMethod must be cash or upi');
    }

    const { rows } = await query<{
      id: string; name: string; unit: string; price: string | number; discount_percent: string | number;
    }>(
      `SELECT p.id, p.name, sp.unit, sp.price::float AS price,
              COALESCE(sp.discount_percent, 0)::float AS discount_percent
         FROM mart_store_products sp
         JOIN mart_products p ON p.id = sp.product_id
        WHERE sp.store_id = $1 AND sp.product_id = $2`,
      [storeId, productId]
    );
    const product = rows[0];
    if (!product) throw badRequest('That product is not listed for this store');

    const discount = num(product.discount_percent);
    const unitPrice = discount > 0
      ? Math.round(num(product.price) * (1 - discount / 100))
      : num(product.price);
    const total = round2(unitPrice * quantity);

    const updated = await query<{ id: string }>(
      `UPDATE mart_offline_sales
         SET sale_date = $2::date, product_id = $3, product_name = $4, unit = $5,
             unit_price = $6, quantity = $7, total = $8, payment_method = $9, notes = $10
       WHERE id = $1 AND store_id = $11
       RETURNING id`,
      [id, date, product.id, product.name, product.unit, unitPrice, quantity, total, paymentMethod, notes, storeId]
    );
    if (updated.rows.length === 0) throw notFound('Offline sale not found');
    return { id: updated.rows[0].id };
  }

  static async removeEntry(id: string, storeId: string): Promise<boolean> {
    const { rows } = await query(
      `DELETE FROM mart_offline_sales WHERE id = $1 AND store_id = $2 RETURNING 1`,
      [id, storeId]
    );
    if (rows.length === 0) throw notFound('Offline sale not found');
    return true;
  }
}
