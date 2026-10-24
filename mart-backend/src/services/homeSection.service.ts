import { query } from '../database/db';
import { badRequest, notFound } from '../utils/apiError';

export type SectionLayout = 'row' | 'grid' | 'hero' | 'tiles';
export type SectionKind =
  | 'manual'
  | 'category'
  | 'combo'
  | 'deals'
  | 'bestsellers'
  | 'new_arrivals'
  | 'buy_again'
  | 'banner'
  | 'category_tiles';

export interface HomeSectionConfig {
  // Category scope (multi-category supported)
  categorySlug?: string | null;
  categorySlugs?: string[];
  // Hand-picked / ordered product ids
  productIds: string[];
  // Exclusions
  excludeProductIds?: string[];
  // Hard cap
  limit: number | null;
  // Layout override (legacy field; also stored on section.layout)
  layout: SectionLayout | null;
  // Fallback when manual list is empty
  fallback?: 'none' | 'bestsellers' | 'new_arrivals';
  // Sort
  sort?: 'catalogue' | 'discount' | 'price_asc' | 'price_desc' | 'newest' | 'bestselling';
  // Filters
  inStockOnly?: boolean;
  minDiscount?: number;
  windowDays?: number;
  // Banner / tiles
  imageUrl?: string | null;
  href?: string | null;
  alt?: string | null;
  columns?: number | null;
  buttonText?: string | null;
  cta?: string | null;
}

export interface HomeSection {
  id: string;
  storeId: string;
  kind: SectionKind | string;
  title: string;
  subtitle: string | null;
  sortOrder: number;
  isEnabled: boolean;
  layout: SectionLayout;
  badge: string | null;
  startsAt: string | null;
  endsAt: string | null;
  visibilityRule: string | null;
  config: HomeSectionConfig;
  createdAt?: string;
  updatedAt?: string;
  // Populated by publicSections when resolving server-side
  items?: any[];
}

export const SECTION_KINDS: SectionKind[] = [
  'manual', 'category', 'combo', 'deals', 'bestsellers', 'new_arrivals', 'buy_again', 'banner', 'category_tiles'
];
// Keep old test name/export for compatibility
export const HOME_SECTION_KEYS = ['todays_combos', 'fresh_vegetables', 'deals', 'top_picks'];
const KIND_SET = new Set<string>(SECTION_KINDS);

function normalizeKind(k: unknown): unknown {
  if (typeof k !== "string") return k;
  if (KIND_SET.has(k)) return k;
  if (k === "todays_combos") return "combo";
  if (k === "fresh_vegetables") return "category";
  if (k === "top_picks") return "manual";
  if (k === "store_favourites") return "manual";
  if (k === "popular_picks") return "manual";
  if (k === "deals") return "deals";
  return k;
}

export { normalizeKind };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRODUCT_IDS = 60;
const MAX_LIMIT = 60;
const MAX_PRODUCT_ID_LEN = 128;
const BESTSELLER_FALLBACK = 12;

const SELECT = `
  SELECT id, store_id as "storeId", kind,
         title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
         layout, badge, starts_at as "startsAt", ends_at as "endsAt",
         visibility_rule as "visibilityRule",
         config, created_at as "createdAt", updated_at as "updatedAt"
  FROM mart_home_sections
`;

function toArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of v) {
    if (typeof value !== 'string') continue;
    const s = value.trim().toLowerCase();
    if (!s) continue;
    if (!SLUG_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 40) break;
  }
  return out;
}

export function normalizeSectionConfig(config: unknown): HomeSectionConfig {
  const source = config && typeof config === 'object' ? config as Record<string, unknown> : {};

  // Legacy single slug
  const rawSlug = source.categorySlug;
  const categorySlug = typeof rawSlug === 'string' ? rawSlug.trim().toLowerCase() : '';
  if (categorySlug && !SLUG_RE.test(categorySlug)) {
    throw badRequest('Category slug must be lowercase letters, numbers and hyphens');
  }

  // Multi slugs
  let categorySlugs = toArray(source.categorySlugs).map((s: string) => s.trim());
  if (!categorySlugs.length && categorySlug) categorySlugs = [categorySlug];

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

  const rawExc = Array.isArray(source.excludeProductIds) ? source.excludeProductIds : [];
  const excludeSeen = new Set<string>();
  const excludeProductIds: string[] = [];
  for (const value of rawExc) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || id.length > MAX_PRODUCT_ID_LEN || excludeSeen.has(id)) continue;
    excludeSeen.add(id);
    excludeProductIds.push(id);
    if (excludeProductIds.length >= MAX_PRODUCT_IDS) break;
  }

  const rawLimit = Number(source.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : null;

  const layout = source.layout === 'row' || source.layout === 'grid' || source.layout === 'hero' || source.layout === 'tiles' ? source.layout : null;

  const fallback = source.fallback === 'bestsellers' || source.fallback === 'new_arrivals' ? source.fallback : 'none';
  const sort = ['catalogue','discount','price_asc','price_desc','newest','bestselling'].includes(String(source.sort))
    ? (source.sort as HomeSectionConfig['sort']) : 'catalogue';

  const inStockOnly = source.inStockOnly !== false; // default true
  const minDiscount = Number.isInteger(Number(source.minDiscount)) && Number(source.minDiscount) >= 0 ? Number(source.minDiscount) : undefined;
  const windowDays = Number.isInteger(Number(source.windowDays)) && Number(source.windowDays) > 0 ? Math.min(Number(source.windowDays), 365) : undefined;

  const imageUrl = typeof source.imageUrl === 'string' && source.imageUrl.trim() ? source.imageUrl.trim() : null;
  const href = typeof source.href === 'string' && source.href.trim() ? source.href.trim() : null;
  const alt = typeof source.alt === 'string' && source.alt.trim() ? source.alt.trim() : null;
  const buttonText = typeof (source as any).buttonText === 'string' && (source as any).buttonText.trim() ? (source as any).buttonText.trim() : (typeof (source as any).cta === 'string' && (source as any).cta.trim() ? (source as any).cta.trim() : null);
  const rawCols = Number(source.columns);
  const columns = Number.isInteger(rawCols) && rawCols >= 1 && rawCols <= 6 ? rawCols : null;

  const result: any = { categorySlug: categorySlug || (categorySlugs[0] || null), productIds, limit, layout };
  const has = (key: string) => Object.prototype.hasOwnProperty.call(source, key);
  if (has('categorySlugs')) result.categorySlugs = categorySlugs;
  if (has('excludeProductIds')) result.excludeProductIds = excludeProductIds;
  if (fallback !== 'none') result.fallback = fallback;
  if (sort !== 'catalogue') result.sort = sort;
  if (inStockOnly !== true) result.inStockOnly = inStockOnly;
  if (minDiscount !== undefined) result.minDiscount = minDiscount;
  if (windowDays !== undefined) result.windowDays = windowDays;
  if (imageUrl !== null) result.imageUrl = imageUrl;
  if (href !== null) result.href = href;
  if (alt !== null) result.alt = alt;
  if (buttonText !== null) { result.buttonText = buttonText; result.cta = buttonText; }
  if (columns !== null) result.columns = columns;
  return result;
}

function assertKind(kind: unknown): asserts kind is SectionKind {
  const k = normalizeKind(kind);
  if (typeof k !== 'string' || !KIND_SET.has(k)) {
    throw badRequest(`Unknown section kind. Allowed: ${SECTION_KINDS.join(', ')}`);
  }
  (assertKind as any).last = k;
}

function assertTitle(title: unknown): string {
  const value = typeof title === 'string' ? title.trim() : '';
  if (!value) throw badRequest('A section title is required');
  if (value.length > 120) throw badRequest('Section title must be 120 characters or fewer');
  return value;
}

const PRODUCT_RESOLVE_SELECT = `
  SELECT p.id, p.category_id as "categoryId", c.name as "categoryName", c.slug as "categorySlug",
         p.name, p.local_name as "localName", p.search_aliases as "searchAliases",
         p.description, p.photo_url as "photoUrl",
         p.weight_options as "weightOptions",
         sp.price::float as price, sp.unit,
         sp.approx_weight as "approxWeight",
         sp.discount_percent::float as "discountPercent",
         sp.is_available as "isAvailable",
         sp.availability_status as "availabilityStatus",
         p.is_bundle as "isBundle",
         sp.sort_order as "sortOrder",
         p.created_at as "createdAt"
  FROM mart_products p
  JOIN mart_store_products sp ON sp.product_id = p.id AND sp.store_id = $1
  LEFT JOIN mart_categories c ON c.id = p.category_id
  WHERE sp.store_id = $1
`;

async function resolveItems(storeId: string, section: HomeSection): Promise<any[]> {
  const cfg = normalizeSectionConfig(section.config);
  const now = new Date();
  if (section.startsAt && new Date(section.startsAt) > now) return [];
  if (section.endsAt && new Date(section.endsAt) < now) return [];

  const exc = new Set(cfg.excludeProductIds || []);
  const inStock = cfg.inStockOnly !== false;

  // Banner / tiles are config-driven, not product lists
  if (section.kind === 'banner' || section.kind === 'category_tiles') return [];

  // Manual picks
  if (section.kind === 'manual') {
    let ids = cfg.productIds || [];
    const key = (section as any).sectionKey;
    if (!ids.length && (key === 'top_picks' || cfg.fallback === 'bestsellers' || cfg.fallback === 'new_arrivals')) {
      if (key === 'top_picks' || cfg.fallback === 'bestsellers') {
        ids = await bestSellers(storeId);
      } else if (cfg.fallback === 'new_arrivals') {
        ids = await newArrivals(storeId);
      }
    } else if (!ids.length && key === 'top_picks') {
      ids = await bestSellers(storeId);
    }
    return fetchByIds(storeId, ids, exc, inStock);
  }

  // Combos (bundles)
  if (section.kind === 'combo') {
    const slugs = (cfg.categorySlugs || []).map((s: string) => String(s).toLowerCase());
    const params: any[] = [storeId];
    let where = `AND p.is_bundle = true AND (sp.availability_status != 'hidden')`;
    if (inStock) where += ` AND sp.is_available = true AND sp.availability_status != 'out_of_stock'`;
    if (slugs.length) {
      where += ` AND LOWER(c.slug) = ANY($${params.length + 1}::text[])`;
      params.push(slugs);
    }
    if ((cfg.productIds || []).length) {
      where += ` AND p.id = ANY($${params.length + 1}::uuid[])`;
      params.push(cfg.productIds);
    }
    const res = await query(`${PRODUCT_RESOLVE_SELECT.replace('WHERE sp.store_id = $1', `WHERE sp.store_id = $1 ${where}`)} ORDER BY sp.sort_order ASC, p.name ASC`, params);
    let rows = res.rows.filter((r: any) => !exc.has(r.id));
    if ((cfg.productIds || []).length) {
      const map = new Map(rows.map((r: any) => [r.id, r]));
      rows = (cfg.productIds).map((id: string) => map.get(id)).filter(Boolean);
    }
    if (cfg.limit && rows.length > cfg.limit) rows = rows.slice(0, cfg.limit);
    return rows;
  }

  // Deals
  if (section.kind === 'deals') {
    const slugs = (cfg.categorySlugs || []).map((s: string) => String(s).toLowerCase());
    const params: any[] = [storeId];
    let where = `AND sp.discount_percent > 0 AND (sp.availability_status != 'hidden')`;
    if (inStock) where += ` AND sp.is_available = true AND sp.availability_status != 'out_of_stock'`;
    if (typeof cfg.minDiscount === 'number') { where += ` AND sp.discount_percent >= $${params.length + 1}`; params.push(cfg.minDiscount); }
    if (slugs.length) { where += ` AND LOWER(c.slug) = ANY($${params.length + 1}::text[])`; params.push(slugs); }
    const res = await query(`${PRODUCT_RESOLVE_SELECT.replace('WHERE sp.store_id = $1', `WHERE sp.store_id = $1 ${where}`)} ORDER BY sp.discount_percent DESC, sp.sort_order ASC`, params);
    let rows = res.rows.filter((r: any) => !exc.has(r.id));
    if (cfg.limit && rows.length > cfg.limit) rows = rows.slice(0, cfg.limit);
    return rows;
  }

  // Bestsellers
  if (section.kind === 'bestsellers') {
    const slugs = (cfg.categorySlugs || []).map((s: string) => String(s).toLowerCase());
    const days = cfg.windowDays || 30;
    const params: any[] = [storeId, days];
    let cat = '';
    if (slugs.length) { cat = ` AND LOWER(c.slug) = ANY($${params.length + 1}::text[])`; params.push(slugs); }
    const res = await query(
      `SELECT ${PRODUCT_RESOLVE_SELECT.split('FROM')[0].replace('SELECT ', '')}
         FROM mart_products p
         JOIN mart_store_products sp ON sp.product_id = p.id AND sp.store_id = $1
         LEFT JOIN mart_categories c ON c.id = p.category_id
         LEFT JOIN (
           SELECT oi.product_id, SUM(oi.quantity) as qty
           FROM mart_order_items oi
           JOIN mart_orders o ON o.id = oi.order_id
           WHERE o.store_id = $1
             AND o.status NOT IN ('cancelled','failed_delivery','terminated')
             AND o.created_at > NOW() - make_interval(days => $2::int)
           GROUP BY oi.product_id
         ) ob ON ob.product_id = p.id
         WHERE sp.store_id = $1
           AND (sp.availability_status != 'hidden')
           AND (${inStock ? 'sp.is_available = true AND sp.availability_status != \'out_of_stock\'' : 'true'})
           ${cat}
         ORDER BY COALESCE(ob.qty, 0) DESC, sp.sort_order ASC
         LIMIT 60`,
      params
    );
    let rows = res.rows.filter((r: any) => !exc.has(r.id));
    if (cfg.limit && rows.length > cfg.limit) rows = rows.slice(0, cfg.limit);
    return rows;
  }

  // New arrivals
  if (section.kind === 'new_arrivals') {
    const slugs = (cfg.categorySlugs || []).map((s: string) => String(s).toLowerCase());
    const params: any[] = [storeId];
    let where = `AND (sp.availability_status != 'hidden')`;
    if (inStock) where += ` AND sp.is_available = true AND sp.availability_status != 'out_of_stock'`;
    if (slugs.length) { where += ` AND LOWER(c.slug) = ANY($${params.length + 1}::text[])`; params.push(slugs); }
    const res = await query(`${PRODUCT_RESOLVE_SELECT.replace('WHERE sp.store_id = $1', `WHERE sp.store_id = $1 ${where}`)} ORDER BY p.created_at DESC, sp.sort_order ASC LIMIT 60`, params);
    let rows = res.rows.filter((r: any) => !exc.has(r.id));
    if (cfg.limit && rows.length > cfg.limit) rows = rows.slice(0, cfg.limit);
    return rows;
  }

  // Category
  if (section.kind === 'category') {
    const slugs = (cfg.categorySlugs || (cfg.categorySlug ? [cfg.categorySlug] : [])).map((s: string) => String(s).toLowerCase());
    const params: any[] = [storeId];
    let where = `AND (sp.availability_status != 'hidden')`;
    if (inStock) where += ` AND sp.is_available = true AND sp.availability_status != 'out_of_stock'`;
    if (slugs.length) { where += ` AND LOWER(c.slug) = ANY($${params.length + 1}::text[])`; params.push(slugs); }
    else return [];
    let order = 'ORDER BY sp.sort_order ASC, p.name ASC';
    if (cfg.sort === 'price_asc') order = 'ORDER BY sp.price ASC';
    else if (cfg.sort === 'price_desc') order = 'ORDER BY sp.price DESC';
    else if (cfg.sort === 'newest') order = 'ORDER BY p.created_at DESC';
    const res = await query(`${PRODUCT_RESOLVE_SELECT.replace('WHERE sp.store_id = $1', `WHERE sp.store_id = $1 ${where}`)} ${order} LIMIT 60`, params);
    let rows = res.rows.filter((r: any) => !exc.has(r.id));
    // If manual picks also provided, intersect+order by picks
    if ((cfg.productIds || []).length) {
      const map = new Map(rows.map((r: any) => [r.id, r]));
      const picked = (cfg.productIds).map((id: string) => map.get(id)).filter(Boolean);
      const rest = rows.filter((r: any) => !(cfg.productIds as string[]).includes(r.id));
      rows = [...picked, ...rest];
    }
    if (cfg.limit && rows.length > cfg.limit) rows = rows.slice(0, cfg.limit);
    return rows;
  }

  // buy_again: not resolved here without customer context; return empty
  if (section.kind === 'buy_again') return [];

  return [];
}

async function fetchByIds(storeId: string, ids: string[], exc: Set<string>, inStock: boolean): Promise<any[]> {
  if (!ids.length) return [];
  const params: any[] = [storeId, ids];
  let where = inStock ? `AND sp.is_available = true AND sp.availability_status != 'out_of_stock'` : '';
  const res = await query(
    `${PRODUCT_RESOLVE_SELECT.replace('WHERE sp.store_id = $1', `WHERE sp.store_id = $1 AND p.id = ANY($2::uuid[]) ${where}`)}`,
    params
  );
  const map = new Map(res.rows.map((r: any) => [r.id, r]));
  return ids.map(id => map.get(id)).filter((p: any) => p && !exc.has(p.id));
}

async function bestSellers(storeId: string): Promise<string[]> {
  const res = await query(
    `SELECT oi.product_id as id
       FROM mart_order_items oi
       JOIN mart_orders o ON o.id = oi.order_id
       JOIN mart_store_products sp ON sp.product_id = oi.product_id AND sp.store_id = $1
       WHERE o.store_id = $1
         AND o.status NOT IN ('cancelled','failed_delivery','terminated')
         AND sp.is_available = true
       GROUP BY oi.product_id
       ORDER BY SUM(oi.quantity) DESC, MAX(o.created_at) DESC
       LIMIT $2`,
    [storeId, BESTSELLER_FALLBACK]
  );
  return res.rows.map((r: any) => r.id || r.product_id || r.productId).filter(Boolean);
}

async function newArrivals(storeId: string): Promise<string[]> {
  const res = await query(
    `SELECT p.id
       FROM mart_products p
       JOIN mart_store_products sp ON sp.product_id = p.id AND sp.store_id = $1
       WHERE sp.store_id = $1 AND sp.is_available = true
       ORDER BY p.created_at DESC
       LIMIT $2`,
    [storeId, BESTSELLER_FALLBACK]
  );
  return res.rows.map((r: any) => r.id);
}

export class HomeSectionService {
  static async findById(id: string, storeId: string): Promise<HomeSection | null> {
    const result = await query<HomeSection>(
      `SELECT id, store_id as "storeId", kind as "sectionKey", kind,
              title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
              layout, badge, starts_at as "startsAt", ends_at as "endsAt",
              visibility_rule as "visibilityRule",
              config, created_at as "createdAt", updated_at as "updatedAt"
       FROM mart_home_sections WHERE id = $1 AND store_id = $2`,
      [id, storeId]
    );
    if (!result.rows[0]) return null;
    const r: any = result.rows[0];
    if (!r.kind && r.sectionKey) r.kind = normalizeKind(r.sectionKey);
    if (r.kind) r.kind = normalizeKind(r.kind);
    return r;
  }

  static async findByStore(storeId: string, enabledOnly = false): Promise<HomeSection[]> {
    const conditions = ['store_id = $1'];
    if (enabledOnly) conditions.push('is_enabled = true');
    const result = await query<HomeSection>(
      `SELECT id, store_id as "storeId", kind as "sectionKey", kind,
              title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
              layout, badge, starts_at as "startsAt", ends_at as "endsAt",
              visibility_rule as "visibilityRule",
              config, created_at as "createdAt", updated_at as "updatedAt"
       FROM mart_home_sections WHERE ${conditions.join(' AND ')} ORDER BY sort_order ASC, created_at ASC`,
      [storeId]
    );
    return result.rows.map((r: any) => { if (!r.kind && r.sectionKey) r.kind = normalizeKind(r.sectionKey); if (r.kind) r.kind = normalizeKind(r.kind); return r; });
  }

  static async publicSections(storeId: string): Promise<HomeSection[]> {
    const sections = await this.findByStore(storeId, true);
    const now = new Date();
    const live: HomeSection[] = [];
    for (const section of sections as any[]) {
      let kind = section.kind || section.sectionKey;
      const origKey = section.sectionKey || section.kind;
      if (origKey === 'top_picks') {
        kind = 'manual';
      }
      const sec = { ...section, kind, sectionKey: origKey };
      if (sec.startsAt && new Date(sec.startsAt) > now) continue;
      if (sec.endsAt && new Date(sec.endsAt) < now) continue;
      const items = await resolveItems(storeId, sec as any);
      if ((kind === 'banner' || kind === 'category_tiles')) {
        live.push({ ...sec, items, kind, sectionKey: origKey });
        continue;
      }
      if (!items.length) continue;
      const cfg: any = normalizeSectionConfig(sec.config || {});
      // Ensure productIds reflect resolved order if we have items
      if (Array.isArray(items) && items.length) {
        cfg.productIds = items.map((it: any) => it.id || it.productId).filter(Boolean);
      }
      live.push({ ...sec, items, kind, sectionKey: origKey, config: cfg });
    }
    return live;
  }

  static async create(storeId: string, data: {
    kind?: unknown; sectionKey?: unknown; type?: unknown; key?: unknown;
    title?: unknown; subtitle?: unknown;
    isEnabled?: unknown; sortOrder?: unknown; config?: unknown;
    layout?: unknown; badge?: unknown; startsAt?: unknown; endsAt?: unknown; visibilityRule?: unknown;
  }): Promise<HomeSection> {
    const kindInput = data.kind ?? (data as any).sectionKey ?? (data as any).type ?? (data as any).key;
    assertKind(kindInput);
    const kind = (normalizeKind((assertKind as any).last !== undefined ? (assertKind as any).last : kindInput) as string) || normalizeKind(kindInput) as string;
    const title = assertTitle(data.title);
    const subtitle = typeof data.subtitle === 'string' && data.subtitle.trim() ? data.subtitle.trim() : null;
    const config = normalizeSectionConfig(data.config);
    const layout = data.layout === 'grid' || data.layout === 'hero' || data.layout === 'tiles' ? data.layout : 'row';
    const badge = typeof data.badge === 'string' && data.badge.trim() ? data.badge.trim().slice(0, 24) : null;
    const startsAt = typeof data.startsAt === 'string' && data.startsAt ? data.startsAt : null;
    const endsAt = typeof data.endsAt === 'string' && data.endsAt ? data.endsAt : null;
    const visibilityRule = typeof data.visibilityRule === 'string' && data.visibilityRule.trim() ? data.visibilityRule.trim().slice(0, 64) : 'always';

    const { rows } = await query<{ next: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM mart_home_sections WHERE store_id = $1`,
      [storeId]
    );
    const sortOrder = Number.isInteger(Number(data.sortOrder)) && data.sortOrder !== undefined ? Number(data.sortOrder) : rows[0]?.next ?? 1;

    const result = await query<HomeSection>(
      `INSERT INTO mart_home_sections (store_id, kind, title, subtitle, sort_order, is_enabled, layout, badge, starts_at, ends_at, visibility_rule, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, store_id as "storeId", kind,
                 title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
                 layout, badge, starts_at as "startsAt", ends_at as "endsAt",
                 visibility_rule as "visibilityRule",
                 config, created_at as "createdAt", updated_at as "updatedAt"`,
      [storeId, kind, title, subtitle, sortOrder,
       data.isEnabled !== false, layout, badge, startsAt, endsAt, visibilityRule,
       JSON.stringify(config)]
    );
    return result.rows[0];
  }

  static async update(id: string, storeId: string, data: {
    title?: unknown; subtitle?: unknown; isEnabled?: unknown;
    sortOrder?: unknown; config?: unknown; kind?: unknown;
    layout?: unknown; badge?: unknown; startsAt?: unknown; endsAt?: unknown; visibilityRule?: unknown;
  }): Promise<HomeSection | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (data.kind !== undefined) {
      const kind = normalizeKind(data.kind);
      assertKind(kind);
      fields.push(`kind = $${i++}`); params.push(kind);
    }
    if (data.title !== undefined) { fields.push(`title = $${i++}`); params.push(assertTitle(data.title)); }
    if (data.subtitle !== undefined) { fields.push(`subtitle = $${i++}`); params.push(typeof data.subtitle === 'string' && data.subtitle.trim() ? data.subtitle.trim() : null); }
    if (data.isEnabled !== undefined) { fields.push(`is_enabled = $${i++}`); params.push(data.isEnabled === true); }
    if (data.sortOrder !== undefined) { fields.push(`sort_order = $${i++}`); params.push(Number(data.sortOrder) || 0); }
    if (data.config !== undefined) { fields.push(`config = $${i++}`); params.push(JSON.stringify(normalizeSectionConfig(data.config))); }
    if (data.layout !== undefined) { const l = data.layout === 'grid' || data.layout === 'hero' || data.layout === 'tiles' ? data.layout : 'row'; fields.push(`layout = $${i++}`); params.push(l); }
    if (data.badge !== undefined) { const b = typeof data.badge === 'string' && data.badge.trim() ? data.badge.trim().slice(0, 24) : null; fields.push(`badge = $${i++}`); params.push(b); }
    if (data.startsAt !== undefined) { fields.push(`starts_at = $${i++}`); params.push(typeof data.startsAt === 'string' && data.startsAt ? data.startsAt : null); }
    if (data.endsAt !== undefined) { fields.push(`ends_at = $${i++}`); params.push(typeof data.endsAt === 'string' && data.endsAt ? data.endsAt : null); }
    if (data.visibilityRule !== undefined) { fields.push(`visibility_rule = $${i++}`); params.push(typeof data.visibilityRule === 'string' && data.visibilityRule.trim() ? data.visibilityRule.trim().slice(0, 64) : 'always'); }

    if (!fields.length) return this.findById(id, storeId);
    fields.push(`updated_at = NOW()`);
    params.push(id, storeId);

    const result = await query<HomeSection>(
      `UPDATE mart_home_sections SET ${fields.join(', ')}
       WHERE id = $${i} AND store_id = $${i + 1}
       RETURNING id, store_id as "storeId", kind,
                 title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
                 layout, badge, starts_at as "startsAt", ends_at as "endsAt",
                 visibility_rule as "visibilityRule",
                 config, created_at as "createdAt", updated_at as "updatedAt"`,
      params
    );
    return result.rows[0] || null;
  }

  static async duplicate(id: string, storeId: string): Promise<HomeSection | null> {
    const src = await this.findById(id, storeId);
    if (!src) return null;
    const { rows } = await query<{ next: number }>(`SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM mart_home_sections WHERE store_id = $1`, [storeId]);
    const result = await query<HomeSection>(
      `INSERT INTO mart_home_sections (store_id, kind, title, subtitle, sort_order, is_enabled, layout, badge, starts_at, ends_at, visibility_rule, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, store_id as "storeId", kind,
                 title, subtitle, sort_order as "sortOrder", is_enabled as "isEnabled",
                 layout, badge, starts_at as "startsAt", ends_at as "endsAt",
                 visibility_rule as "visibilityRule",
                 config, created_at as "createdAt", updated_at as "updatedAt"`,
      [storeId, src.kind, src.title + ' (copy)', src.subtitle, rows[0]?.next ?? 1,
       false, src.layout || 'row', src.badge, src.startsAt, src.endsAt, src.visibilityRule || 'always',
       JSON.stringify(src.config)]
    );
    return result.rows[0] || null;
  }

  static async delete(id: string, storeId: string): Promise<void> {
    const result = await query<{ id: string }>(`DELETE FROM mart_home_sections WHERE id = $1 AND store_id = $2 RETURNING id`, [id, storeId]);
    if (!result.rows.length) throw notFound('Section not found');
  }

  static async reorder(storeId: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await query(`UPDATE mart_home_sections SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`, [i + 1, ids[i], storeId]);
    }
  }
}
