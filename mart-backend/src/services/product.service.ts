import { query, transaction } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { badRequest } from '../utils/apiError';
import { ZoneService } from './zone.service';
import { ProductImageAssetService } from './productImageAsset.service';

export interface MartProduct {
  id: string;
  productCode: string;
  categoryId: string | null;
  categoryName?: string;
  name: string;
  localName: string | null;
  searchAliases: string[];
  description: string | null;
  photoUrl: string | null;
  photos: string[];
  photoVariants: ProductImageVariant[];
  smallUrl: string | null;
  thumbnailUrl: string | null;
  largeUrl: string | null;
  price: number;
  unit: string;
  approxWeight: string | null;
  weightOptions: Array<{ label: string; price: number }> | null;
  discountPercent: number;
  isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  isBundle: boolean;
  isCatalog: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImageVariant {
  smallUrl: string;
  thumbnailUrl: string;
  largeUrl: string;
}

function normalizePhotoVariants(value: unknown, photos: unknown, photoUrl: unknown): ProductImageVariant[] {
  const legacyPhotos = Array.isArray(photos)
    ? photos.filter((photo): photo is string => typeof photo === 'string' && photo.length > 0)
    : (typeof photoUrl === 'string' && photoUrl ? [photoUrl] : []);
  const supplied = Array.isArray(value) ? value : [];
  return supplied.map((entry, index) => {
    const source = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const fallback = legacyPhotos[index] || legacyPhotos[0] || '';
    const largeUrl = typeof source.largeUrl === 'string' && source.largeUrl ? source.largeUrl : fallback;
    const thumbnailUrl = typeof source.thumbnailUrl === 'string' && source.thumbnailUrl ? source.thumbnailUrl : largeUrl;
    const smallUrl = typeof source.smallUrl === 'string' && source.smallUrl ? source.smallUrl : thumbnailUrl;
    return { smallUrl, thumbnailUrl, largeUrl };
  }).filter(variant => Boolean(variant.largeUrl));
}

function decorateProductImages<T extends { photoUrl: string | null; photos: unknown; photoVariants?: unknown }>(product: T): T & {
  photos: string[];
  photoVariants: ProductImageVariant[];
  smallUrl: string | null;
  thumbnailUrl: string | null;
  largeUrl: string | null;
} {
  const photoVariants = normalizePhotoVariants(product.photoVariants, product.photos, product.photoUrl);
  const photos = Array.isArray(product.photos)
    ? product.photos.filter((photo): photo is string => typeof photo === 'string' && photo.length > 0)
    : [];
  const primary = photoVariants[0];
  return {
    ...product,
    photoUrl: product.photoUrl || primary?.largeUrl || null,
    photos: photos.length ? photos : photoVariants.map(variant => variant.largeUrl),
    photoVariants,
    smallUrl: primary?.smallUrl || primary?.thumbnailUrl || product.photoUrl || null,
    thumbnailUrl: primary?.thumbnailUrl || product.photoUrl || null,
    largeUrl: primary?.largeUrl || product.photoUrl || null,
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.product_code as "productCode", p.category_id as "categoryId", c.name as "categoryName",
         p.name, p.local_name as "localName", p.search_aliases as "searchAliases",
          p.description, p.photo_url as "photoUrl", p.photos as "photos", p.photo_variants as "photoVariants",
          p.weight_options as "weightOptions",
          sp.price::float, sp.unit,
         sp.approx_weight as "approxWeight",
         sp.discount_percent::float as "discountPercent",
         sp.is_available as "isAvailable",
         sp.availability_status as "availabilityStatus",
         p.is_bundle as "isBundle",
         p.is_catalog as "isCatalog",
         sp.sort_order as "sortOrder",
         sp.stock_quantity::float as "stockQuantity",
         sp.low_stock_threshold::float as "lowStockThreshold",
         sp.stock_unit as "stockUnit",
         p.created_at as "createdAt", p.updated_at as "updatedAt"
  FROM mart_products p
  JOIN mart_store_products sp ON sp.product_id = p.id
  LEFT JOIN mart_categories c ON c.id = p.category_id
`;
const BUNDLE_DEDUCTION_UNITS = new Set(['kg', 'g', 'pcs', 'dozen', 'litre', 'ml', 'bunch', 'packet']);

export function normalizeSearchAliases(value: unknown): string[] {
  if (!Array.isArray(value)) throw badRequest('Search aliases must be a list of text values');
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') throw badRequest('Search aliases must contain only text values');
    const alias = entry.trim().replace(/\s+/g, ' ');
    if (!alias) continue;
    if (alias.length > 80) throw badRequest('Each search alias must be 80 characters or fewer');
    const key = alias.toLocaleLowerCase();
    if (!seen.has(key)) { seen.add(key); aliases.push(alias); }
  }
  if (aliases.length > 20) throw badRequest('Use at most 20 search aliases per product');
  return aliases;
}

/**
 * Name limits.
 *
 * The storefront renders the main name and the local (Hindi) name together as
 * one bracketed label, so the limits are sized for that combined string: a
 * 40-character name plus a 30-character local name still fits a phone card
 * over the three lines the card allows. The hub inputs enforce the same
 * numbers.
 */
export const MAX_PRODUCT_NAME_LENGTH = 40;
export const MAX_LOCAL_NAME_LENGTH = 30;

/** Trims a product name and rejects one that is empty or over the limit. */
export function normalizeProductName(value: unknown, label = 'Product name'): string {
  if (typeof value !== 'string') throw badRequest(`${label} is required`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest(`${label} is required`);
  if (name.length > MAX_PRODUCT_NAME_LENGTH) {
    throw badRequest(`${label} must be ${MAX_PRODUCT_NAME_LENGTH} characters or fewer`);
  }
  return name;
}

/** Trims the optional local (Hindi) name and rejects one that is over the limit. */
export function normalizeLocalName(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('Hindi name must be text');
  const localName = value.trim().replace(/\s+/g, ' ');
  if (!localName) return null;
  if (localName.length > MAX_LOCAL_NAME_LENGTH) {
    throw badRequest(`Hindi name must be ${MAX_LOCAL_NAME_LENGTH} characters or fewer`);
  }
  return localName;
}

export class ProductService {
  static async findAll(filters?: {
    storeId?: string;
    categoryId?: string;
    available?: boolean;
    excludeHidden?: boolean;
    activeCategoryOnly?: boolean;
    onlyFulfillableBundles?: boolean;
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
    if (filters?.activeCategoryOnly) {
      conditions.push(`p.category_id IS NOT NULL`);
      conditions.push(`c.is_active = true`);
    }
    if (filters?.onlyFulfillableBundles) {
      conditions.push(`(
        p.is_bundle = false
        OR (
          (SELECT COUNT(*) FROM mart_bundle_components bc
           WHERE bc.store_id = sp.store_id AND bc.bundle_product_id = p.id) >= 2
          AND NOT EXISTS (
            SELECT 1
            FROM mart_bundle_components bc
            LEFT JOIN mart_store_products component_sp
              ON component_sp.store_id = bc.store_id
             AND component_sp.product_id = bc.component_product_id
            WHERE bc.store_id = sp.store_id
              AND bc.bundle_product_id = p.id
              AND (component_sp.product_id IS NULL
                OR component_sp.is_available IS NOT TRUE
                OR component_sp.availability_status <> 'available')
          )
        )
      )`);
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
    return result.rows.map(decorateProductImages);
  }

  /**
   * Combined catalog of every store tagged in a zone. The union is deduped
   * per product: when two stores in one zone list the same product, the zone
   * head's listing wins (deterministic, and the head is the store the customer
   * already sees as the face of the zone). Every row carries the store id
   * that fulfils it so an order line knows where it comes from.
   */
  static async findAllForZone(zoneId: string, filters?: {
    categoryId?: string;
    excludeHidden?: boolean;
    activeCategoryOnly?: boolean;
  }): Promise<Array<MartProduct & { storeId: string; storeName: string }>> {
    const zone = await ZoneService.findById(zoneId);
    if (!zone) return [];
    const storeIds: string[] = zone.stores?.length
      ? zone.stores.map(s => s.id)
      : (zone.primaryStoreId ? [zone.primaryStoreId] : []);
    if (!storeIds.length) return [];
    const conditions: string[] = [`sp.store_id = ANY($1)`];
    const params: unknown[] = [storeIds];
    let i = 2;
    if (filters?.categoryId) {
      conditions.push(`p.category_id = $${i++}`);
      params.push(filters.categoryId);
    }
    if (filters?.excludeHidden) {
      conditions.push(`sp.availability_status != 'hidden'`);
    }
    if (filters?.activeCategoryOnly) {
      conditions.push(`p.category_id IS NOT NULL`);
      conditions.push(`c.is_active = true`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await query<MartProduct & { storeId: string; storeName: string }>(
      `SELECT p.id, p.product_code as "productCode", p.category_id as "categoryId", c.name as "categoryName",
             p.name, p.local_name as "localName", p.search_aliases as "searchAliases",
              p.description, p.photo_url as "photoUrl", p.photos as "photos", p.photo_variants as "photoVariants",
              p.weight_options as "weightOptions",
              sp.price::float, sp.unit,
             sp.approx_weight as "approxWeight",
             sp.discount_percent::float as "discountPercent",
             sp.is_available as "isAvailable",
             sp.availability_status as "availabilityStatus",
             p.is_bundle as "isBundle",
             p.is_catalog as "isCatalog",
             sp.sort_order as "sortOrder",
             sp.stock_quantity::float as "stockQuantity",
             sp.low_stock_threshold::float as "lowStockThreshold",
             sp.stock_unit as "stockUnit",
             p.created_at as "createdAt", p.updated_at as "updatedAt",
             sp.store_id as "storeId", s.name as "storeName"
       FROM mart_products p
       JOIN mart_store_products sp ON sp.product_id = p.id
       JOIN mart_stores s ON s.id = sp.store_id
       LEFT JOIN mart_categories c ON c.id = p.category_id
       ${where}
       ORDER BY
         CASE WHEN sp.availability_status = 'out_of_stock' THEN 1 ELSE 0 END ASC,
         sp.sort_order ASC, p.name ASC`,
      params
    );
    // For each product keep exactly one row: the head store's listing when it
    // lists the product, otherwise any member store's.
    const primaryId = zone.primaryStoreId;
    const bestById = new Map<string, MartProduct & { storeId: string; storeName: string }>();
    for (const row of result.rows.map(decorateProductImages)) {
      const existing = bestById.get(row.id);
      if (!existing) { bestById.set(row.id, row); continue; }
      if (row.storeId === primaryId && existing.storeId !== primaryId) bestById.set(row.id, row);
    }
    return Array.from(bestById.values());
  }

  static async findById(id: string, storeId?: string): Promise<MartProduct | null> {
    const conditions = [`p.id = $1`];
    const params: unknown[] = [id];
    if (storeId) { conditions.push(`sp.store_id = $2`); params.push(storeId); }
    const result = await query<MartProduct>(
      `${PRODUCT_SELECT} WHERE ${conditions.join(' AND ')}`,
      params
    );
    return result.rows[0] ? decorateProductImages(result.rows[0]) : null;
  }

  // Create global product + store_product entry
  static async create(data: Partial<MartProduct> & { storeId: string; isCatalog?: boolean }): Promise<MartProduct> {
    const id = uuidv4();
    const searchAliases = data.searchAliases === undefined ? [] : normalizeSearchAliases(data.searchAliases);
    const name = normalizeProductName(data.name);
    const localName = normalizeLocalName(data.localName);
    const photos = data.photos && data.photos.length
      ? data.photos.map(photo => String(photo)).filter(Boolean)
      : (data.photoUrl ? [String(data.photoUrl)] : []);
    const photoVariants = normalizePhotoVariants((data as any).photoVariants, photos, data.photoUrl);
    await query(
      `INSERT INTO mart_products (id, category_id, name, local_name, search_aliases, description, photo_url, photos, photo_variants, weight_options, is_catalog)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, data.categoryId || null, name, localName, searchAliases,
       data.description || null, photos[0] || null, JSON.stringify(photos), JSON.stringify(photoVariants),
       data.weightOptions ? JSON.stringify(data.weightOptions) : null,
       data.isCatalog === true]
    );
    await query(
      `INSERT INTO mart_store_products
         (store_id, product_id, price, unit, discount_percent, availability_status, is_available, sort_order, approx_weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [data.storeId, id, data.price, data.unit || '1 kg',
       data.discountPercent || 0,
       data.availabilityStatus || 'available',
       data.isAvailable !== false,
       data.sortOrder || 0,
       data.approxWeight || null]
    );
    return (await this.findById(id, data.storeId))!;
  }

  static async createBundle(data: Partial<MartProduct> & {
    storeId: string;
    components: Array<{ productId: string; quantity: number; unit: string }>;
    imageAssetIds?: string[];
    adminId?: string;
  }): Promise<MartProduct> {
    const name = normalizeProductName(data.name, 'Combo name');
    // Validated before the transaction opens: a rejected name must not take a
    // connection and a rollback to fail.
    const localName = normalizeLocalName(data.localName);
    const searchAliases = data.searchAliases === undefined ? [] : normalizeSearchAliases(data.searchAliases);
    const unit = data.unit?.trim();
    if (!data.categoryId) throw badRequest('A combo category is required');
    if (!Number.isFinite(Number(data.price)) || Number(data.price) < 0 || !unit) {
      throw badRequest('Enter a valid combo price and quantity');
    }
    if (!Array.isArray(data.components) || data.components.length < 2) {
      throw badRequest('Choose at least two products for this combo');
    }
    const componentIds = new Set<string>();
    for (const component of data.components) {
      const componentUnit = component?.unit?.trim().toLowerCase();
      if (!component?.productId || !Number.isFinite(Number(component.quantity)) || Number(component.quantity) <= 0 || !componentUnit) {
        throw badRequest('Every combo item needs a quantity and measure');
      }
      if (!BUNDLE_DEDUCTION_UNITS.has(componentUnit)) throw badRequest('Use a supported inventory measure for every combo item');
      if (componentIds.has(component.productId)) throw badRequest('Add each product only once to a combo');
      componentIds.add(component.productId);
    }

    const id = uuidv4();
    await transaction(async client => {
      const components: Array<{ productId: string; quantity: number; unit: string }> = [];
      for (const component of data.components) {
        const result = await client.query(
          `SELECT p.is_bundle as "isBundle", p.is_catalog as "isCatalog"
           FROM mart_store_products sp JOIN mart_products p ON p.id = sp.product_id
           WHERE sp.store_id = $1 AND sp.product_id = $2
           FOR SHARE`,
          [data.storeId, component.productId]
        );
        const row = result.rows[0] as { isBundle: boolean; isCatalog: boolean } | undefined;
        if (!row || row.isBundle || !row.isCatalog) {
          throw badRequest('Combo items must be catalog products already added to this store');
        }
        components.push({ productId: component.productId, quantity: Number(component.quantity), unit: component.unit.trim().toLowerCase() });
      }
      await client.query(
        `INSERT INTO mart_products (id, category_id, name, local_name, search_aliases, description, photo_url, photos, photo_variants, is_bundle)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
          [id, data.categoryId, name, localName, searchAliases, data.description || null, data.photoUrl || null,
          JSON.stringify(data.photoUrl ? [data.photoUrl] : []), JSON.stringify(normalizePhotoVariants((data as any).photoVariants, data.photoUrl ? [data.photoUrl] : [], data.photoUrl))]
      );
      if (data.imageAssetIds !== undefined) {
        if (!data.adminId) throw badRequest('Missing admin identity for image upload');
        await ProductImageAssetService.syncProductAssets(client, id, data.imageAssetIds, data.adminId);
      }
      await client.query(
        `INSERT INTO mart_store_products
           (store_id, product_id, price, unit, discount_percent, availability_status, is_available, sort_order)
         VALUES ($1,$2,$3,$4,0,$5,$6,$7)`,
        [data.storeId, id, Number(data.price), unit, data.availabilityStatus || 'available', data.availabilityStatus !== 'hidden', data.sortOrder || 0]
      );
      for (const component of components) {
        await client.query(
          `INSERT INTO mart_bundle_components (store_id, bundle_product_id, component_product_id, quantity, deduction_unit)
           VALUES ($1,$2,$3,$4,$5)`,
          [data.storeId, id, component.productId, component.quantity, component.unit]
        );
      }
    });
    return (await this.findById(id, data.storeId))!;
  }

  static async getBundleComponents(bundleProductId: string, storeId: string): Promise<Array<{
    productId: string;
    quantity: number;
    unit: string;
  }>> {
    const result = await query<{ productId: string; quantity: number; unit: string }>(
      `SELECT component_product_id as "productId", quantity::float, deduction_unit as unit
         FROM mart_bundle_components
        WHERE bundle_product_id = $1 AND store_id = $2
        ORDER BY created_at ASC`,
      [bundleProductId, storeId]
    );
    return result.rows;
  }

  static async replaceBundleComponents(
    bundleProductId: string,
    storeId: string,
    components: Array<{ productId: string; quantity: number; unit: string }>
  ): Promise<void> {
    if (!Array.isArray(components) || components.length < 2) {
      throw badRequest('Choose at least two products for this combo');
    }
    const componentIds = new Set<string>();
    for (const component of components) {
      const componentUnit = component?.unit?.trim().toLowerCase();
      if (!component?.productId || !Number.isFinite(Number(component.quantity)) || Number(component.quantity) <= 0 || !componentUnit) {
        throw badRequest('Every combo item needs a quantity and measure');
      }
      if (!BUNDLE_DEDUCTION_UNITS.has(componentUnit)) throw badRequest('Use a supported inventory measure for every combo item');
      if (componentIds.has(component.productId)) throw badRequest('Add each product only once to a combo');
      componentIds.add(component.productId);
    }

    await transaction(async client => {
      const bundleResult = await client.query(
        `SELECT p.is_bundle as "isBundle"
           FROM mart_store_products sp
           JOIN mart_products p ON p.id = sp.product_id
          WHERE sp.store_id = $1 AND sp.product_id = $2
          FOR UPDATE`,
        [storeId, bundleProductId]
      );
      if (!bundleResult.rows[0]?.isBundle) throw badRequest('Combo not found in this store');

      for (const component of components) {
        const componentResult = await client.query(
          `SELECT p.is_bundle as "isBundle", p.is_catalog as "isCatalog"
             FROM mart_store_products sp
             JOIN mart_products p ON p.id = sp.product_id
            WHERE sp.store_id = $1 AND sp.product_id = $2
            FOR SHARE`,
          [storeId, component.productId]
        );
        const componentRow = componentResult.rows[0] as { isBundle: boolean; isCatalog: boolean } | undefined;
        if (!componentRow || componentRow.isBundle || !componentRow.isCatalog) {
          throw badRequest('Combo items must be catalog products already added to this store');
        }
      }

      await client.query(
        `DELETE FROM mart_bundle_components WHERE bundle_product_id = $1 AND store_id = $2`,
        [bundleProductId, storeId]
      );
      for (const component of components) {
        await client.query(
          `INSERT INTO mart_bundle_components (store_id, bundle_product_id, component_product_id, quantity, deduction_unit)
           VALUES ($1,$2,$3,$4,$5)`,
          [storeId, bundleProductId, component.productId, Number(component.quantity), component.unit.trim().toLowerCase()]
        );
      }
    });
  }

  // Update: global fields (name, photo, description) + store-specific fields (price, availability)
  static async update(id: string, data: Partial<MartProduct> & { storeId?: string; imageAssetIds?: string[]; adminId?: string }): Promise<MartProduct | null> {
    // Update global product fields
    const globalFields: string[] = [];
    const globalParams: unknown[] = [];
    let gi = 1;
    if (data.categoryId !== undefined) { globalFields.push(`category_id = $${gi++}`); globalParams.push(data.categoryId); }
    if (data.name !== undefined)       { globalFields.push(`name = $${gi++}`);        globalParams.push(normalizeProductName(data.name)); }
    if (data.localName !== undefined)  { globalFields.push(`local_name = $${gi++}`);  globalParams.push(normalizeLocalName(data.localName)); }
    if (data.searchAliases !== undefined) { globalFields.push(`search_aliases = $${gi++}`); globalParams.push(normalizeSearchAliases(data.searchAliases)); }
    if (data.description !== undefined){ globalFields.push(`description = $${gi++}`); globalParams.push(data.description); }
    if (data.photoUrl !== undefined)   { globalFields.push(`photo_url = $${gi++}`);   globalParams.push(data.photoUrl); }
    if (data.photos !== undefined)     { globalFields.push(`photos = $${gi++}::jsonb`); globalParams.push(JSON.stringify(data.photos)); }
    if ((data as any).photoVariants !== undefined) { globalFields.push(`photo_variants = $${gi++}::jsonb`); globalParams.push(JSON.stringify((data as any).photoVariants)); }
    if (data.weightOptions !== undefined){ globalFields.push(`weight_options = $${gi++}`); globalParams.push(JSON.stringify(data.weightOptions)); }
    if ((data as any).isCatalog !== undefined) { globalFields.push(`is_catalog = $${gi++}`); globalParams.push((data as any).isCatalog === true); }
    await transaction(async client => {
      if (globalFields.length) {
        globalFields.push(`updated_at = NOW()`);
        globalParams.push(id);
        await client.query(`UPDATE mart_products SET ${globalFields.join(', ')} WHERE id = $${gi}`, globalParams);
      }

      if (data.imageAssetIds !== undefined) {
        if (!data.adminId) throw badRequest('Missing admin identity for image upload');
        await ProductImageAssetService.syncProductAssets(client, id, data.imageAssetIds, data.adminId);
      }

      // Update store-specific fields
      if (!data.storeId) return;
      const storeFields: string[] = [];
      const storeParams: unknown[] = [];
      let si = 1;
      if (data.price !== undefined)           { storeFields.push(`price = $${si++}`);               storeParams.push(data.price); }
      if (data.unit !== undefined)            { storeFields.push(`unit = $${si++}`);                storeParams.push(data.unit); }
      if (data.approxWeight !== undefined)    { storeFields.push(`approx_weight = $${si++}`);       storeParams.push(data.approxWeight || null); }
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
        await client.query(
          `UPDATE mart_store_products SET ${storeFields.join(', ')} WHERE store_id = $${si} AND product_id = $${si + 1}`,
          storeParams
        );
      }
    });

    return this.findById(id, data.storeId);
  }

  static async delete(id: string): Promise<void> {
    await transaction(async client => {
      await ProductImageAssetService.queueProductAssets(client, id);
      await client.query(`DELETE FROM mart_products WHERE id = $1`, [id]);
    });
  }

  static async removeFromStore(productId: string, storeId: string): Promise<void> {
    await transaction(async client => {
      const listing = await client.query(
        `SELECT p.is_bundle as "isBundle"
           FROM mart_store_products sp
           JOIN mart_products p ON p.id = sp.product_id
          WHERE sp.store_id = $1 AND sp.product_id = $2
          FOR UPDATE`,
        [storeId, productId]
      );
      const product = listing.rows[0] as { isBundle: boolean } | undefined;
      if (!product) throw badRequest('Product is not listed in this store');
      if (product.isBundle) throw badRequest('Manage combos from the combo editor');

      const usedByCombo = await client.query(
        `SELECT 1
           FROM mart_bundle_components
          WHERE store_id = $1 AND component_product_id = $2
          LIMIT 1`,
        [storeId, productId]
      );
      if (usedByCombo.rows.length) {
        throw badRequest('Remove this product from the store combo before removing it from the store list');
      }

      await client.query(
        `DELETE FROM mart_store_products WHERE store_id = $1 AND product_id = $2`,
        [storeId, productId]
      );
    });
  }

  // Assign an existing catalog product to a store
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

  // Bulk assign multiple catalog products to a store
  static async bulkAssignToStore(storeId: string, items: Array<{
    productId: string; price: number; unit: string; discountPercent?: number;
  }>): Promise<void> {
    for (const item of items) {
      await this.assignToStore(item.productId, storeId, item);
    }
  }

  // Get product IDs already assigned to a store (from catalog)
  static async getStoreProductIds(storeId: string): Promise<string[]> {
    const result = await query<{ product_id: string }>(
      `SELECT sp.product_id FROM mart_store_products sp
       JOIN mart_products p ON p.id = sp.product_id
        WHERE sp.store_id = $1 AND p.is_catalog = true AND p.is_bundle = false`,
      [storeId]
    );
    return result.rows.map(r => r.product_id);
  }

  // Create catalog-only product (no store assignment)
  static async createCatalogProduct(data: {
    name: string; localName?: string; description?: string;
    photoUrl?: string; photos?: string[]; photoVariants?: ProductImageVariant[]; imageAssetIds?: string[]; adminId: string; categoryId?: string; searchAliases?: string[];
  }): Promise<{ id: string; productCode: string; name: string; photos: string[] }> {
    const id = uuidv4();
    const searchAliases = data.searchAliases === undefined ? [] : normalizeSearchAliases(data.searchAliases);
    const name = normalizeProductName(data.name);
    const localName = normalizeLocalName(data.localName);
    const photos = data.photos && data.photos.length
      ? data.photos.map(photo => String(photo)).filter(Boolean)
      : (data.photoUrl ? [String(data.photoUrl)] : []);
    const photoVariants = normalizePhotoVariants(data.photoVariants, photos, data.photoUrl);
    return transaction(async client => {
      const result = await client.query(
        `INSERT INTO mart_products (id, category_id, name, local_name, search_aliases, description, photo_url, photos, photo_variants, is_catalog)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
        RETURNING id, product_code as "productCode", name, photos`,
        [id, data.categoryId || null, name, localName, searchAliases,
         data.description || null, photos[0] || null, JSON.stringify(photos), JSON.stringify(photoVariants)]
      );
      if (data.imageAssetIds !== undefined) {
        await ProductImageAssetService.syncProductAssets(client, id, data.imageAssetIds, data.adminId);
      }
      return result.rows[0] as { id: string; productCode: string; name: string; photos: string[] };
    });
  }

  // Update is_catalog flag on existing product
  static async setCatalogFlag(id: string, isCatalog: boolean): Promise<void> {
    await query(`UPDATE mart_products SET is_catalog = $1, updated_at = NOW() WHERE id = $2`, [isCatalog, id]);
  }
}
