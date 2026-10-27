/**
 * Cart-aware recommendation engine.
 *
 * Two modes, determined entirely by existing Hub settings:
 *   Mode A — "Help reach free delivery": subtotal < free_delivery_above
 *   Mode B — "Normal discovery":         subtotal >= free_delivery_above (or no threshold)
 *
 * Mode B ranking layers (each fills gaps left by the previous):
 *   1. Personalised repeat-buy  — products this customer has ordered before, not in cart
 *   2. Co-occurrence            — products that appear in the same delivered orders as cart items
 *   3. Complementary categories — name-pattern fallback when co-occurrence has no data
 *   4. Store bestsellers        — last 60 days delivered orders
 *   5. Discounted items         — anything on sale not yet in cart
 *   6. Any available product    — guarantees the rail is never empty
 *
 * All thresholds are read from mart_settings via SettingsService — never
 * hardcoded. A Hub change takes effect on the next request with no deploy.
 */

import { query } from '../database/db';
import { SettingsService } from './settings.service';

export type RecommendationMode = 'free_delivery' | 'discovery';

export interface RecommendationResult {
  mode: RecommendationMode;
  remainingForFreeDelivery: number;
  freeDeliveryThreshold: number;
  deliveryCharge: number;
  products: RecommendedProduct[];
}

export interface RecommendedProduct {
  id: string;
  name: string;
  localName: string | null;
  photoUrl: string | null;
  price: number;
  unit: string;
  discountPercent: number;
  categoryId: string;
  categoryName: string;
  isAvailable: boolean;
  availabilityStatus: string;
  approxWeight: string | null;
  isBundle: boolean;
}

interface CartItem {
  productId: string;
}

const MAX_RESULTS = 10;

// ── Shared product SELECT columns (used in every query) ───────────────────────
const PRODUCT_COLS = `
  p.id, p.name, p.local_name AS "localName", p.photo_url AS "photoUrl",
  sp.price::float AS price,
  sp.unit, sp.discount_percent::float AS "discountPercent",
  p.category_id AS "categoryId", c.name AS "categoryName",
  sp.is_available AS "isAvailable",
  sp.availability_status AS "availabilityStatus",
  sp.approx_weight AS "approxWeight",
  p.is_bundle AS "isBundle"
`;

const AVAILABLE_WHERE = `
  sp.is_available = true
  AND sp.availability_status = 'available'
  AND sp.price > 0
  AND c.is_active = true
`;

export class RecommendationService {
  static async getRecommendations(
    storeId: string,
    cartItems: CartItem[],
    cartSubtotal: number,
    customerId: string | null,
    guestPhone: string | null = null,
    limit = MAX_RESULTS,
  ): Promise<RecommendationResult> {
    const settings = await SettingsService.getPublic(storeId);
    const freeAbove = parseFloat(settings.free_delivery_above || '0');
    const deliveryCharge = parseFloat(settings.delivery_charge || '0');

    const remaining = freeAbove > 0 ? Math.max(0, freeAbove - cartSubtotal) : 0;
    const mode: RecommendationMode =
      freeAbove > 0 && deliveryCharge > 0 && cartSubtotal < freeAbove
        ? 'free_delivery'
        : 'discovery';

    const cartProductIds = cartItems.map(i => i.productId);

    const products = mode === 'free_delivery'
      ? await this.modeAProducts(storeId, cartProductIds, remaining, limit)
      : await this.modeBProducts(storeId, cartProductIds, customerId, guestPhone, limit);

    return { mode, remainingForFreeDelivery: remaining, freeDeliveryThreshold: freeAbove, deliveryCharge, products };
  }

  // ── Mode A: bridge the free-delivery gap ─────────────────────────────────────
  // Priority: exact bridge (smallest overshoot) → closest below → bestseller tie-break
  private static async modeAProducts(
    storeId: string,
    cartProductIds: string[],
    remaining: number,
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const excludeClause = cartProductIds.length > 0 ? `AND sp.product_id != ALL($2::uuid[])` : '';
    const params: unknown[] = [storeId];
    if (cartProductIds.length > 0) params.push(cartProductIds);
    const r = remaining > 0 ? remaining : 0;

    const result = await query<RecommendedProduct>(
      `WITH bestsellers AS (
         SELECT oi.product_id, COUNT(*)::int AS freq
         FROM mart_order_items oi
         JOIN mart_orders o ON o.id = oi.order_id
         WHERE o.store_id = $1 AND o.status = 'delivered'
           AND o.created_at >= NOW() - INTERVAL '60 days'
         GROUP BY oi.product_id
       )
       SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       LEFT JOIN bestsellers b ON b.product_id = sp.product_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE} ${excludeClause}
       ORDER BY
         -- group 0: bridges or exceeds gap (smallest overshoot first)
         CASE WHEN (CASE WHEN sp.discount_percent > 0
                         THEN ROUND(sp.price * (1 - sp.discount_percent / 100))
                         ELSE sp.price END) >= ${r}
              THEN 0 ELSE 1 END ASC,
         CASE WHEN (CASE WHEN sp.discount_percent > 0
                         THEN ROUND(sp.price * (1 - sp.discount_percent / 100))
                         ELSE sp.price END) >= ${r}
              THEN (CASE WHEN sp.discount_percent > 0
                         THEN ROUND(sp.price * (1 - sp.discount_percent / 100))
                         ELSE sp.price END)
              ELSE NULL END ASC NULLS LAST,
         -- group 1: below gap, highest price first (gets closest)
         CASE WHEN (CASE WHEN sp.discount_percent > 0
                         THEN ROUND(sp.price * (1 - sp.discount_percent / 100))
                         ELSE sp.price END) < ${r}
              THEN (CASE WHEN sp.discount_percent > 0
                         THEN ROUND(sp.price * (1 - sp.discount_percent / 100))
                         ELSE sp.price END)
              ELSE NULL END DESC NULLS LAST,
         -- discount signal: on-sale items preferred within same price band
         sp.discount_percent DESC,
         COALESCE(b.freq, 0) DESC,
         p.name ASC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Mode B: layered discovery with fallback chain ─────────────────────────────
  private static async modeBProducts(
    storeId: string,
    cartProductIds: string[],
    customerId: string | null,
    guestPhone: string | null,
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const seen = new Set<string>();
    const results: RecommendedProduct[] = [];

    const fill = (rows: RecommendedProduct[]) => {
      for (const row of rows) {
        if (!seen.has(row.id) && results.length < limit) {
          seen.add(row.id);
          results.push(row);
        }
      }
    };

    // Layer 1a — personalised repeat-buy for logged-in customers
    if (customerId) {
      fill(await this.personalProductsByCustomerId(storeId, cartProductIds, customerId, limit));
    }
    // Layer 1b — phone-based history for guests who have typed their number
    if (!customerId && guestPhone) {
      fill(await this.personalProductsByPhone(storeId, cartProductIds, guestPhone, limit));
    }
    if (results.length >= limit) return results;

    // Layer 2 — co-occurrence (data-driven complementary, works for any category name)
    if (cartProductIds.length > 0) {
      fill(await this.coOccurrenceProducts(storeId, cartProductIds, [...seen], limit - results.length));
    }
    if (results.length >= limit) return results;

    // Layer 3 — name-pattern complementary categories (fallback when co-occurrence has no data)
    const cartCategoryIds = await this.resolveCartCategories(storeId, cartProductIds);
    const complementaryCategoryIds = await this.getComplementaryCategories(cartCategoryIds);
    if (complementaryCategoryIds.length > 0) {
      fill(await this.categoryProducts(storeId, complementaryCategoryIds, [...seen], limit - results.length));
    }
    if (results.length >= limit) return results;

    // Layer 4 — store bestsellers (last 60 days)
    fill(await this.bestsellerProducts(storeId, [...seen], limit - results.length));
    if (results.length >= limit) return results;

    // Layer 5 — discounted items not yet suggested
    fill(await this.discountedProducts(storeId, [...seen], limit - results.length));
    if (results.length >= limit) return results;

    // Layer 6 — any available product (guarantees rail is never empty)
    fill(await this.anyProducts(storeId, [...seen], limit - results.length));

    return results;
  }

  // ── Layer 1a: personalised repeat-buy by customer_id (logged-in) ───────────────
  private static async personalProductsByCustomerId(
    storeId: string,
    cartProductIds: string[],
    customerId: string,
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const excludeClause = cartProductIds.length > 0 ? `AND sp.product_id != ALL($3::uuid[])` : '';
    const params: unknown[] = [storeId, customerId];
    if (cartProductIds.length > 0) params.push(cartProductIds);
    const result = await query<RecommendedProduct>(
      `WITH customer_history AS (
         SELECT oi.product_id,
                MAX(o.created_at) AS last_ordered,
                COUNT(*)::int AS order_count
         FROM mart_order_items oi
         JOIN mart_orders o ON o.id = oi.order_id
         WHERE o.store_id = $1
           AND o.customer_id = $2
           AND o.status = 'delivered'
         GROUP BY oi.product_id
       )
       SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       JOIN customer_history h ON h.product_id = sp.product_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE} ${excludeClause}
       ORDER BY h.order_count DESC, h.last_ordered DESC, sp.discount_percent DESC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Layer 1b: personalised repeat-buy by guest_phone (guests) ────────────────
  // guest_phone is stored on every order so a repeat guest who has typed their
  // number gets the same history signal as a logged-in customer.
  private static async personalProductsByPhone(
    storeId: string,
    cartProductIds: string[],
    guestPhone: string,
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const excludeClause = cartProductIds.length > 0 ? `AND sp.product_id != ALL($3::uuid[])` : '';
    const params: unknown[] = [storeId, guestPhone];
    if (cartProductIds.length > 0) params.push(cartProductIds);
    const result = await query<RecommendedProduct>(
      `WITH phone_history AS (
         SELECT oi.product_id,
                MAX(o.created_at) AS last_ordered,
                COUNT(*)::int AS order_count
         FROM mart_order_items oi
         JOIN mart_orders o ON o.id = oi.order_id
         WHERE o.store_id = $1
           AND o.guest_phone = $2
           AND o.status = 'delivered'
         GROUP BY oi.product_id
       )
       SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       JOIN phone_history h ON h.product_id = sp.product_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE} ${excludeClause}
       ORDER BY h.order_count DESC, h.last_ordered DESC, sp.discount_percent DESC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Layer 2: co-occurrence ────────────────────────────────────────────────────
  // Products that appear most often in the same delivered orders as the cart items.
  // Data-driven: works for any store, any category name, any language.
  // "People who bought what you have also bought these."
  private static async coOccurrenceProducts(
    storeId: string,
    cartProductIds: string[],
    excludeIds: string[],
    limit: number,
  ): Promise<RecommendedProduct[]> {
    // $1 = storeId, $2 = cartProductIds, $3 = allExclude
    const allExclude = [...new Set([...cartProductIds, ...excludeIds])];
    const params: unknown[] = [storeId, cartProductIds, allExclude];

    const result = await query<RecommendedProduct>(
      `WITH cart_orders AS (
         SELECT DISTINCT o.id AS order_id
         FROM mart_order_items oi
         JOIN mart_orders o ON o.id = oi.order_id
         WHERE o.store_id = $1
           AND o.status = 'delivered'
           AND o.created_at >= NOW() - INTERVAL '90 days'
           AND oi.product_id = ANY($2::uuid[])
       ),
       co_occur AS (
         SELECT oi.product_id, COUNT(*)::int AS co_count
         FROM mart_order_items oi
         JOIN cart_orders co ON co.order_id = oi.order_id
         WHERE oi.product_id != ALL($2::uuid[])
         GROUP BY oi.product_id
       )
       SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       JOIN co_occur cc ON cc.product_id = sp.product_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE}
         AND sp.product_id != ALL($3::uuid[])
       ORDER BY cc.co_count DESC, sp.discount_percent DESC, p.name ASC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Layer 3: complementary category products ──────────────────────────────────
  private static async categoryProducts(
    storeId: string,
    categoryIds: string[],
    excludeIds: string[],
    limit: number,
  ): Promise<RecommendedProduct[]> {
    if (categoryIds.length === 0) return [];
    const params: unknown[] = [storeId, categoryIds];
    const excludeClause = excludeIds.length > 0 ? `AND sp.product_id != ALL($3::uuid[])` : '';
    if (excludeIds.length > 0) params.push(excludeIds);

    const result = await query<RecommendedProduct>(
      `WITH bestsellers AS (
         SELECT oi.product_id, COUNT(*)::int AS freq
         FROM mart_order_items oi
         JOIN mart_orders o ON o.id = oi.order_id
         WHERE o.store_id = $1 AND o.status = 'delivered'
           AND o.created_at >= NOW() - INTERVAL '60 days'
         GROUP BY oi.product_id
       )
       SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       LEFT JOIN bestsellers b ON b.product_id = sp.product_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE}
         AND p.category_id = ANY($2::uuid[]) ${excludeClause}
       ORDER BY COALESCE(b.freq, 0) DESC, sp.discount_percent DESC, p.name ASC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Layer 4: store bestsellers ────────────────────────────────────────────────
  private static async bestsellerProducts(
    storeId: string,
    excludeIds: string[],
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const excludeClause = excludeIds.length > 0 ? `AND sp.product_id != ALL($2::uuid[])` : '';
    const params: unknown[] = [storeId];
    if (excludeIds.length > 0) params.push(excludeIds);

    const result = await query<RecommendedProduct>(
      `WITH bestsellers AS (
         SELECT oi.product_id, COUNT(*)::int AS freq
         FROM mart_order_items oi
         JOIN mart_orders o ON o.id = oi.order_id
         WHERE o.store_id = $1 AND o.status = 'delivered'
           AND o.created_at >= NOW() - INTERVAL '60 days'
         GROUP BY oi.product_id
       )
       SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       JOIN bestsellers b ON b.product_id = sp.product_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE} ${excludeClause}
       ORDER BY b.freq DESC, sp.discount_percent DESC, p.name ASC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Layer 5: discounted items ─────────────────────────────────────────────────
  private static async discountedProducts(
    storeId: string,
    excludeIds: string[],
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const excludeClause = excludeIds.length > 0 ? `AND sp.product_id != ALL($2::uuid[])` : '';
    const params: unknown[] = [storeId];
    if (excludeIds.length > 0) params.push(excludeIds);

    const result = await query<RecommendedProduct>(
      `SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE}
         AND sp.discount_percent > 0 ${excludeClause}
       ORDER BY sp.discount_percent DESC, p.name ASC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Layer 6: any available product ───────────────────────────────────────────
  private static async anyProducts(
    storeId: string,
    excludeIds: string[],
    limit: number,
  ): Promise<RecommendedProduct[]> {
    const excludeClause = excludeIds.length > 0 ? `AND sp.product_id != ALL($2::uuid[])` : '';
    const params: unknown[] = [storeId];
    if (excludeIds.length > 0) params.push(excludeIds);

    const result = await query<RecommendedProduct>(
      `SELECT ${PRODUCT_COLS}
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       WHERE sp.store_id = $1 AND ${AVAILABLE_WHERE} ${excludeClause}
       ORDER BY p.name ASC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private static async resolveCartCategories(storeId: string, productIds: string[]): Promise<string[]> {
    if (productIds.length === 0) return [];
    const result = await query<{ category_id: string }>(
      `SELECT DISTINCT p.category_id
       FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
       WHERE sp.store_id = $1
         AND sp.product_id = ANY($2::uuid[])
         AND p.category_id IS NOT NULL`,
      [storeId, productIds],
    );
    return result.rows.map(r => r.category_id);
  }

  private static async getComplementaryCategories(categoryIds: string[]): Promise<string[]> {
    if (categoryIds.length === 0) return [];
    const catResult = await query<{ id: string; name: string }>(
      `SELECT id, name FROM mart_categories WHERE id = ANY($1::uuid[])`,
      [categoryIds],
    );
    const patterns: string[] = [];
    for (const { name } of catResult.rows) {
      const n = name.toLowerCase();
      if (n.includes('vegetable') || n.includes('sabzi'))      patterns.push('%fruit%', '%dal%', '%pulse%', '%lentil%');
      else if (n.includes('fruit'))                             patterns.push('%vegetable%', '%sabzi%', '%juice%');
      else if (n.includes('dairy') || n.includes('milk'))      patterns.push('%bread%', '%bakery%', '%egg%');
      else if (n.includes('bread') || n.includes('bakery'))    patterns.push('%dairy%', '%milk%', '%butter%', '%jam%');
      else if (n.includes('rice') || n.includes('grain'))      patterns.push('%dal%', '%pulse%', '%spice%', '%masala%');
      else if (n.includes('snack'))                             patterns.push('%beverage%', '%drink%', '%juice%');
      else if (n.includes('spice') || n.includes('masala'))    patterns.push('%rice%', '%grain%', '%dal%');
      else if (n.includes('egg'))                              patterns.push('%bread%', '%dairy%', '%butter%');
    }
    if (patterns.length === 0) return [];
    const likeClause = patterns.map((_, i) => `name ILIKE $${i + 2}`).join(' OR ');
    const result = await query<{ id: string }>(
      `SELECT id FROM mart_categories
       WHERE (${likeClause}) AND id != ALL($1::uuid[]) AND is_active = true`,
      [categoryIds, ...patterns],
    );
    return result.rows.map(r => r.id);
  }
}
