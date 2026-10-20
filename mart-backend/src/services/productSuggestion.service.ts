import { query } from '../database/db';

export type SuggestionStatus = 'new' | 'reviewing' | 'added' | 'declined';
export type BuyerType = 'new' | 'repeat';
export type SuggestionRange = 'today' | '7d' | '30d' | 'custom' | 'all';

const RANGE_DAYS: Record<Exclude<SuggestionRange, 'custom'>, number | null> = { today: null, '7d': 7, '30d': 30, all: null };

// A caller can hand us any string (the controllers cast req.query straight to
// SuggestionRange). Unknown ranges must not reach the interpolated INTERVAL,
// where an undefined day count would produce a 500, so coerce to a safe default.
function normaliseRange(range: SuggestionRange): SuggestionRange {
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, range) || range === 'custom' ? range : '30d';
}

// Same IST windowing the customer-lead reporting uses, so "today" on the hub
// means today in India regardless of where the server or the admin is.
//
// `startIndex` is the 1-based placeholder number the first generated parameter
// should use, so callers can compose this fragment after their own filter
// params without any string rewriting of placeholders.
function istRangeWhere(column: string, range: SuggestionRange, from?: string, to?: string, startIndex = 1): { sql: string; params: unknown[] } {
  range = normaliseRange(range);
  const startOfToday = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  if (range === 'custom') {
    if (!from || !to) return { sql: 'FALSE', params: [] };
    return {
      sql: `${column} >= ($${startIndex}::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${column} < (($${startIndex + 1}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      params: [from, to],
    };
  }
  if (range === 'all') return { sql: 'TRUE', params: [] };
  if (range === 'today') return { sql: `${column} >= ${startOfToday}`, params: [] };
  return {
    sql: `${column} >= (${startOfToday} - (($${startIndex}::int - 1) * INTERVAL '1 day'))`,
    params: [RANGE_DAYS[range]],
  };
}

// Exported for unit testing: composing the date fragment's placeholders after
// caller-supplied filter params is the one place a silent off-by-one could ship
// a query the DB rejects, and the test harness stubs the database.
export const __testables = { normaliseRange, istRangeWhere };
export interface CreateSuggestionInput {
  customerId: string | null;
  phone: string | null;
  name: string | null;
  suggestedProduct: string;
  detail: string | null;
  zoneId: string | null;
  zoneName: string | null;
  storeId: string | null;
  storeName: string | null;
  contactConsent: boolean;
}

export class ProductSuggestionService {
  /**
   * Demand context for the submitter, resolved live at submit time so the hub
   * sees who was asking and how much they had already bought. A guest with no
   * matching order history is 'new'; anyone with at least one delivered order is
   * 'repeat'. Matching is by normalised phone so a signed-in and guest ask from
   * the same number classify the same way.
   */
  static async resolveContext(phone: string | null): Promise<{ buyerType: BuyerType; orderCount: number }> {
    if (!phone) return { buyerType: 'new', orderCount: 0 };
    const clean = phone.replace(/\D/g, '');
    if (!clean) return { buyerType: 'new', orderCount: 0 };
    const result = await query<{ delivered: number }>(
      `SELECT COUNT(*)::int AS delivered
       FROM mart_orders o
       LEFT JOIN mart_customers c ON c.id = o.customer_id
       WHERE o.status = 'delivered'
         AND NULLIF(regexp_replace(COALESCE(o.guest_phone, c.phone), '\\D', '', 'g'), '') = $1`,
      [clean]
    );
    const orderCount = result.rows[0]?.delivered ?? 0;
    return { buyerType: orderCount > 0 ? 'repeat' : 'new', orderCount };
  }

  static async create(input: CreateSuggestionInput) {
    const context = await this.resolveContext(input.phone);
    const result = await query(
      `INSERT INTO mart_product_suggestions
         (customer_id, phone, name, suggested_product, detail,
          zone_id, zone_name, store_id, store_name,
          buyer_type, order_count, contact_consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, created_at AS "createdAt"`,
      [
        input.customerId, input.phone, input.name, input.suggestedProduct, input.detail,
        input.zoneId, input.zoneName, input.storeId, input.storeName,
        context.buyerType, context.orderCount, input.contactConsent,
      ]
    );
    return { ...result.rows[0], buyerType: context.buyerType, orderCount: context.orderCount };
  }

  static async findAll(
    filters: { status?: SuggestionStatus | 'all'; buyerType?: BuyerType | 'all'; zoneId?: string } = {},
    range: SuggestionRange = '30d',
    from?: string,
    to?: string,
    limit = 200
  ) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status && filters.status !== 'all') { conditions.push(`status = $${i++}`); params.push(filters.status); }
    if (filters.buyerType && filters.buyerType !== 'all') { conditions.push(`buyer_type = $${i++}`); params.push(filters.buyerType); }
    if (filters.zoneId) { conditions.push(`zone_id = $${i++}`); params.push(filters.zoneId); }
    // The date range is generated with an explicit starting placeholder so it
    // slots in after the filter params above without rewriting any placeholders.
    const dateRange = istRangeWhere('created_at', range, from, to, i);
    if (dateRange.sql !== 'TRUE') {
      conditions.push(dateRange.sql);
      params.push(...dateRange.params);
      i += dateRange.params.length;
    }
    params.push(Math.min(Math.max(limit, 1), 500));
    const where = conditions.length ? conditions.join(' AND ') : 'TRUE';
    const result = await query(
      `SELECT id, customer_id AS "customerId", phone, name,
              suggested_product AS "suggestedProduct", detail,
              zone_id AS "zoneId", zone_name AS "zoneName",
              store_id AS "storeId", store_name AS "storeName",
              buyer_type AS "buyerType", order_count AS "orderCount",
              contact_consent AS "contactConsent", status,
              created_at AS "createdAt"
       FROM mart_product_suggestions
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  /**
   * Insight rollup for the super admin: how many asks, the new-vs-repeat split,
   * the most-requested items, and the zones demand is clustering in.
   */
  static async getInsights(range: SuggestionRange = '30d', from?: string, to?: string) {
    const dateRange = istRangeWhere('created_at', range, from, to);
    const [counts, topProducts, topZones, byStatus] = await Promise.all([
      query<{ total: number; newBuyers: number; repeatBuyers: number; consented: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE buyer_type = 'new')::int AS "newBuyers",
                COUNT(*) FILTER (WHERE buyer_type = 'repeat')::int AS "repeatBuyers",
                COUNT(*) FILTER (WHERE contact_consent)::int AS consented
         FROM mart_product_suggestions WHERE ${dateRange.sql}`,
        dateRange.params
      ),
      query<{ product: string; count: number }>(
        `SELECT lower(trim(suggested_product)) AS product, COUNT(*)::int AS count
         FROM mart_product_suggestions WHERE ${dateRange.sql}
         GROUP BY 1 ORDER BY count DESC, product ASC LIMIT 10`,
        dateRange.params
      ),
      query<{ zoneId: string | null; zoneName: string | null; count: number }>(
        `SELECT zone_id AS "zoneId", zone_name AS "zoneName", COUNT(*)::int AS count
         FROM mart_product_suggestions WHERE ${dateRange.sql}
         GROUP BY zone_id, zone_name ORDER BY count DESC LIMIT 10`,
        dateRange.params
      ),
      query<{ status: string; count: number }>(
        `SELECT status, COUNT(*)::int AS count
         FROM mart_product_suggestions WHERE ${dateRange.sql}
         GROUP BY status`,
        dateRange.params
      ),
    ]);
    return {
      counts: counts.rows[0] || { total: 0, newBuyers: 0, repeatBuyers: 0, consented: 0 },
      topProducts: topProducts.rows,
      topZones: topZones.rows,
      byStatus: byStatus.rows,
    };
  }

  static async updateStatus(id: string, status: SuggestionStatus) {
    const result = await query(
      `UPDATE mart_product_suggestions SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, status, updated_at AS "updatedAt"`,
      [status, id]
    );
    return result.rows[0] || null;
  }
}
