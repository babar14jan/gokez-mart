import { query } from '../database/db';
import { badRequest, notFound } from '../utils/apiError';

/**
 * A configurable homepage section. The storefront renders the enabled rows in
 * `sortOrder`; `sectionKey` tells it *how* to render (a combo carousel vs a
 * category grid) and `config` carries the small amount of per-section setting.
 *
 * Product content is deliberately not stored here: each section resolves its
 * products live from the existing products/bundles tables so prices, discounts
 * and availability can never drift from the catalogue.
 */
export type SectionLayout = 'row' | 'grid';

export interface HomeSectionConfig {
  /** Restrict the section to one category slug. */
  categorySlug: string | null;
  /** Ordered product ids for a hand-picked section (e.g. Store Favourites). */
  productIds: string[];
  /** Hard cap on how many products the section may show. */
  limit: number | null;
  /** Override the default layout; null lets the section key decide. */
  layout: SectionLayout | null;
}

export interface HomeSection {
  id: string;
  storeId: string;
  sectionKey: string;
  title: string;
  subtitle: string | null;
  sortOrder: number;
  isEnabled: boolean;
  config: HomeSectionConfig;
  createdAt?: string;
  updatedAt?: string;
}

// The storefront knows how to render exactly these keys. Adding a new section
// type means teaching both the Hub editor and the storefront about it, so an
// unknown key is rejected rather than silently stored and never shown.
export const HOME_SECTION_KEYS = ['todays_combos', 'fresh_vegetables', 'deals', 'top_picks'] as const;
export type HomeSectionKey = typeof HOME_SECTION_KEYS[number];
const SECTION_KEY_SET = new Set<string>(HOME_SECTION_KEYS);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRODUCT_IDS = 60;
const MAX_LIMIT = 60;
const MAX_PRODUCT_ID_LEN = 128;
// When a Store Favourites section has no hand-picked products yet, that many
// bestselling ids are served instead so the row never shows up empty.
const TOP_PICKS_BESTSELLER_FALLBACK = 12;

const SELECT = `
  SELECT id, store_id as "storeId", section_key as "sectionKey",
         title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
         config, created_at as "createdAt", updated_at as "updatedAt"
  FROM mart_home_sections
`;

/**
 * Reduce arbitrary input to the only shape the storefront understands. Unknown
 * fields are dropped rather than persisted, so a malformed client payload can
 * never widen what the section pushes to the storefront.
 */
export function normalizeSectionConfig(config: unknown): HomeSectionConfig {
  const source = config && typeof config === 'object' ? config as Record<string, unknown> : {};

  const rawSlug = source.categorySlug;
  const categorySlug = typeof rawSlug === 'string' ? rawSlug.trim().toLowerCase() : '';
  if (categorySlug && !SLUG_RE.test(categorySlug)) {
    throw badRequest('Category slug must be lowercase letters, numbers and hyphens (e.g. vegetables)');
  }

  // Hand-picked product ids: strings only, trimmed, de-duplicated, capped.
  const rawIds = Array.isArray(source.productIds) ? source.productIds : [];
  const seen = new Set<string>();
  const productIds: string[] = [];
  for (const value of rawIds) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || id.length > MAX_PRODUCT_ID_LEN || seen.has(id)) continue;
    seen.add(id);
    productIds.push(id);
    if (productIds.length >= MAX_PRODUCT_IDS) break;
  }

  const rawLimit = Number(source.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : null;

  const layout = source.layout === 'row' || source.layout === 'grid' ? source.layout : null;

  return { categorySlug: categorySlug || null, productIds, limit, layout };
}

function assertSectionKey(key: unknown): asserts key is HomeSectionKey {
  if (typeof key !== 'string' || !SECTION_KEY_SET.has(key)) {
    throw badRequest(`Unknown section. Allowed sections: ${HOME_SECTION_KEYS.join(', ')}`);
  }
}

function assertTitle(title: unknown): string {
  const value = typeof title === 'string' ? title.trim() : '';
  if (!value) throw badRequest('A section title is required');
  if (value.length > 120) throw badRequest('Section title must be 120 characters or fewer');
  return value;
}

export class HomeSectionService {
  static async findByStore(storeId: string, enabledOnly = false): Promise<HomeSection[]> {
    const conditions = ['store_id = $1'];
    if (enabledOnly) conditions.push('is_enabled = true');
    const result = await query<HomeSection>(
      `${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY sort_order ASC, title ASC`,
      [storeId]
    );
    return result.rows;
  }

  /**
   * The storefront view of a store's enabled sections. Store Favourites
   * (`top_picks`) is smart about an empty pick list: instead of returning a
   * section with no products, it fills it with the store's current bestsellers
   * (units actually ordered, cancelled/failed/terminated excluded, only live
   * items). Once the store person hand-picks products, their explicit list and
   * order win. Nothing here is written back — `/home-sections` stays a pure read.
   */
  static async publicSections(storeId: string): Promise<HomeSection[]> {
    const sections = await this.findByStore(storeId, true);
    return Promise.all(sections.map(async (section) => {
      if (section.sectionKey !== 'top_picks' || section.config.productIds.length > 0) return section;
      const result = await query<{ productId: string }>(
        `SELECT oi.product_id AS "productId"
           FROM mart_order_items oi
           JOIN mart_orders o ON o.id = oi.order_id
           JOIN mart_store_products sp ON sp.product_id = oi.product_id AND sp.store_id = $1
          WHERE o.store_id = $1
            AND o.status NOT IN ('cancelled','failed_delivery','terminated')
            AND sp.is_available = true
          GROUP BY oi.product_id
          ORDER BY SUM(oi.quantity) DESC, MAX(o.created_at) DESC
          LIMIT $2`,
        [storeId, TOP_PICKS_BESTSELLER_FALLBACK]
      );
      return { ...section, config: { ...section.config, productIds: result.rows.map(r => r.productId) } };
    }));
  }

  static async findById(id: string, storeId: string): Promise<HomeSection | null> {
    const result = await query<HomeSection>(
      `${SELECT} WHERE id = $1 AND store_id = $2`,
      [id, storeId]
    );
    return result.rows[0] || null;
  }

  static async create(storeId: string, data: {
    sectionKey?: unknown; title?: unknown; subtitle?: unknown;
    isEnabled?: unknown; sortOrder?: unknown; config?: unknown;
  }): Promise<HomeSection> {
    assertSectionKey(data.sectionKey);
    const title = assertTitle(data.title);
    const subtitle = typeof data.subtitle === 'string' && data.subtitle.trim()
      ? data.subtitle.trim() : null;
    const config = normalizeSectionConfig(data.config);

    // Default new sections to the end of the list rather than colliding on 0.
    const { rows } = await query<{ next: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM mart_home_sections WHERE store_id = $1`,
      [storeId]
    );
    const sortOrder = Number.isInteger(Number(data.sortOrder)) && data.sortOrder !== undefined
      ? Number(data.sortOrder) : rows[0]?.next ?? 1;

    const result = await query<HomeSection>(
      `INSERT INTO mart_home_sections (store_id, section_key, title, subtitle, sort_order, is_enabled, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, store_id as "storeId", section_key as "sectionKey",
                 title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
                 config, created_at as "createdAt", updated_at as "updatedAt"`,
      [storeId, data.sectionKey, title, subtitle, sortOrder,
       data.isEnabled !== false, JSON.stringify(config)]
    );
    return result.rows[0];
  }

  static async update(id: string, storeId: string, data: {
    title?: unknown; subtitle?: unknown; isEnabled?: unknown;
    sortOrder?: unknown; config?: unknown;
  }): Promise<HomeSection | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (data.title !== undefined)    { fields.push(`title = $${i++}`);      params.push(assertTitle(data.title)); }
    if (data.subtitle !== undefined) { fields.push(`subtitle = $${i++}`);   params.push(typeof data.subtitle === 'string' && data.subtitle.trim() ? data.subtitle.trim() : null); }
    if (data.isEnabled !== undefined){ fields.push(`is_enabled = $${i++}`); params.push(data.isEnabled === true); }
    if (data.sortOrder !== undefined){ fields.push(`sort_order = $${i++}`); params.push(Number(data.sortOrder) || 0); }
    if (data.config !== undefined)   { fields.push(`config = $${i++}`);     params.push(JSON.stringify(normalizeSectionConfig(data.config))); }

    if (!fields.length) return this.findById(id, storeId);
    fields.push(`updated_at = NOW()`);
    params.push(id, storeId);

    const result = await query<HomeSection>(
      `UPDATE mart_home_sections SET ${fields.join(', ')}
       WHERE id = $${i} AND store_id = $${i + 1}
       RETURNING id, store_id as "storeId", section_key as "sectionKey",
                 title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
                 config, created_at as "createdAt", updated_at as "updatedAt"`,
      params
    );
    return result.rows[0] || null;
  }

  static async delete(id: string, storeId: string): Promise<void> {
    const result = await query<{ id: string }>(
      `DELETE FROM mart_home_sections WHERE id = $1 AND store_id = $2 RETURNING id`,
      [id, storeId]
    );
    if (!result.rows.length) throw notFound('Section not found');
  }

  /** Reorder in one shot. Ids not belonging to this store are ignored. */
  static async reorder(storeId: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE mart_home_sections SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
        [i + 1, ids[i], storeId]
      );
    }
  }
}
