import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../database/db';
import { badRequest, conflict, notFound } from '../utils/apiError';
import { normalizeCustomerPhone } from '../utils/customerPhone';
import { SettingsService } from './settings.service';

export const RESTORE_STATUSES = [
  'pending', 'confirmed', 'preparing', 'ready_to_pickup',
  'out_for_delivery', 'picked_up', 'delivered',
  'cancelled', 'failed_delivery', 'terminated',
] as const;

export type RestoreStatus = typeof RESTORE_STATUSES[number];

export const RESTORE_PAYMENT_METHODS = ['cod', 'upi', 'phonepay'] as const;
export type RestorePaymentMethod = typeof RESTORE_PAYMENT_METHODS[number];

export interface RestoreOrderActor {
  id: string;
  username: string;
  role: string;
  storeId: string | null;
}

export interface RestoreOrderInput {
  phone: string;
  cartId: string;
  status: RestoreStatus;
  orderNumber?: string;
  storeId?: string;
  deliveryCharge?: number;
  paymentMethod?: RestorePaymentMethod;
  guestName?: string;
  guestAddress?: string;
  notes?: string;
}

export interface RestoreOrderItem {
  productId: string | null;
  productName: string;
  unit: string;
  price: number;
  mrp: number;
  quantity: number;
  total: number;
  storeId: string | null;
  storeName: string | null;
  missingProduct: boolean;
  bundleComponents: Array<{
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
  }>;
}

export interface RestoreCampaignUse {
  id: string;
  campaignId: string;
  title: string | null;
  couponCode: string | null;
  couponCodeUsed: string | null;
  discountApplied: number;
  discountType: string | null;
  usedAt: string;
}

export interface RestoreFunnelMatch {
  orderNumber: string | null;
  total: number | null;
  placedAt: string;
  sessionId: string;
}

export interface RestoreInventoryMatch {
  originalOrderId: string;
  deductedAt: string;
  lines: number;
}

export interface RestoreOrderSuggestion {
  orderNumber: string;
  status: RestoreStatus;
  storeId: string | null;
  storeName: string | null;
  paymentMethod: RestorePaymentMethod;
  subtotal: number;
  deliveryCharge: number;
  campaignDiscount: number;
  total: number;
  itemSavings: number;
  freeDeliverySaving: number;
  storeDeliveryCharge: number;
  createdAt: string;
  deliveredAt: string | null;
  recoveredTotal: number | null;
}

export interface RestoreOrderCandidate {
  cartId: string;
  sessionId: string;
  linkedBy: 'customer' | 'session' | 'campaign';
  convertedAt: string;
  itemCount: number;
  cartSubtotal: number;
  cartItemSignature: string;
  guestName: string;
  guestAddress: string;
  latitude: number | null;
  longitude: number | null;
  items: RestoreOrderItem[];
  campaignUse: RestoreCampaignUse | null;
  funnel: RestoreFunnelMatch | null;
  inventory: RestoreInventoryMatch | null;
  suggestion: RestoreOrderSuggestion;
  warnings: string[];
  alreadyRestoredOrderId: string | null;
}

export interface RestoreLookupResult {
  customer: {
    id: string;
    phone: string;
    name: string | null;
    address: string | null;
  } | null;
  candidates: RestoreOrderCandidate[];
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    createdAt: string;
  }>;
}

interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
}

interface CartRow {
  id: string;
  sessionId: string;
  items: unknown;
  itemCount: number;
  subtotal: number;
  convertedAt: string;
  orderId: string | null;
  customerId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUMBER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function generateOrderNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Array.from({ length: 4 }, () => ORDER_NUMBER_CHARS[Math.floor(Math.random() * ORDER_NUMBER_CHARS.length)]).join('');
  return `MRT${yy}${mm}${dd}${rand}`;
}

function normalizePhone(input: string): string {
  const digits = normalizeCustomerPhone(input);
  const phone = digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(phone)) throw badRequest('Enter a valid 10-digit mobile number');
  return phone;
}

function isRestoreStatus(value: unknown): value is RestoreStatus {
  return typeof value === 'string' && (RESTORE_STATUSES as readonly string[]).includes(value);
}

function isPaymentMethod(value: unknown): value is RestorePaymentMethod {
  return typeof value === 'string' && (RESTORE_PAYMENT_METHODS as readonly string[]).includes(value);
}

function itemSignature(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return items
    .map(item => {
      const row = item as Record<string, unknown>;
      return [row.productId, row.unit, row.price, row.quantity].map(v => String(v ?? '')).join(':');
    })
    .sort()
    .join('|');
}

function parseItems(items: unknown): Array<Record<string, any>> {
  return Array.isArray(items) ? items as Array<Record<string, any>> : [];
}

function parseCoordinates(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

async function uniqueOrderNumber(run: (text: string, params?: unknown[]) => Promise<any>): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateOrderNumber();
    const existing = await run(`SELECT 1 FROM mart_orders WHERE order_number = $1 LIMIT 1`, [candidate]);
    if (!existing.rows?.length) return candidate;
  }
  throw new Error('Could not generate a unique order number');
}

async function findOrphanInventory(
  expected: Map<string, { productId: string; storeId: string }>,
  convertedAt: string,
): Promise<RestoreInventoryMatch | null> {
  if (expected.size === 0) return null;
  const expectedRows = [...expected.values()];
  const productIds = expectedRows.map(row => row.productId);
  const storeIds = expectedRows.map(row => row.storeId);
  const result = await query<{
    originalOrderId: string;
    deductedAt: string;
    lines: number;
  }>(
    `WITH expected AS (
       SELECT DISTINCT * FROM unnest($1::uuid[], $2::uuid[]) AS t(product_id, store_id)
     ),
     orphan AS (
       SELECT l.reference_id, l.product_id, l.store_id, l.created_at
         FROM mart_inventory_log l
        WHERE l.reason = 'order_deducted'
          AND l.reference_id IS NOT NULL
          AND l.created_at >= $3::timestamptz - INTERVAL '1 day'
          AND l.created_at <= $3::timestamptz + INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM mart_orders o WHERE o.id = l.reference_id)
     ),
     grouped AS (
       SELECT o.reference_id,
              COUNT(*)::int AS log_lines,
              COUNT(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM expected e
                   WHERE e.product_id = o.product_id AND e.store_id = o.store_id
                )
              )::int AS matched_lines,
              MIN(o.created_at) AS deducted_at
         FROM orphan o
        GROUP BY o.reference_id
     )
     SELECT reference_id AS "originalOrderId",
            deducted_at AS "deductedAt",
            log_lines AS "lines"
       FROM grouped
      WHERE log_lines = matched_lines AND log_lines > 0
      ORDER BY ABS(EXTRACT(EPOCH FROM (deducted_at - $3::timestamptz)))
      LIMIT 1`,
    [productIds, storeIds, convertedAt]
  );
  return result.rows[0] ?? null;
}

async function findCampaignUse(customerId: string, convertedAt: string): Promise<RestoreCampaignUse | null> {
  const result = await query<RestoreCampaignUse>(
    `SELECT cu.id,
            cu.campaign_id AS "campaignId",
            c.title,
            c.coupon_code AS "couponCode",
            cu.coupon_code_used AS "couponCodeUsed",
            cu.discount_applied::float AS "discountApplied",
            c.discount_type AS "discountType",
            cu.used_at AS "usedAt"
       FROM mart_campaign_uses cu
       JOIN mart_campaigns c ON c.id = cu.campaign_id
      WHERE cu.customer_id = $1
        AND cu.order_id IS NULL
        AND cu.reversed_at IS NULL
        AND ABS(EXTRACT(EPOCH FROM (cu.used_at - $2::timestamptz))) <= 21600
      ORDER BY ABS(EXTRACT(EPOCH FROM (cu.used_at - $2::timestamptz)))
      LIMIT 1`,
    [customerId, convertedAt]
  );
  return result.rows[0] ?? null;
}

async function findFunnelMatch(sessionId: string, convertedAt: string): Promise<RestoreFunnelMatch | null> {
  const result = await query<RestoreFunnelMatch>(
    `SELECT props->>'orderNumber' AS "orderNumber",
            CASE WHEN (props->>'value') ~ '^[0-9]+(\\.[0-9]+)?$'
                 THEN (props->>'value')::float ELSE NULL END AS total,
            created_at AS "placedAt",
            session_id AS "sessionId"
       FROM mart_funnel_events
      WHERE session_id = $1
        AND event_name = 'order_placed'
        AND ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))) <= 900
      ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz)))
      LIMIT 1`,
    [sessionId, convertedAt]
  );
  return result.rows[0] ?? null;
}

async function findAttribution(sessionId: string) {
  const result = await query<any>(
    `SELECT s.session_id AS "sessionId",
            s.visitor_id AS "visitorId",
            s.source,
            s.medium,
            s.utm_campaign AS "utmCampaign",
            s.qr_code_id AS "qrCodeId",
            v.first_source AS "firstSource",
            v.first_medium AS "firstMedium",
            v.first_campaign AS "firstCampaign",
            v.first_qr_code_id AS "firstQrCodeId",
            v.last_source AS "lastSource",
            v.last_medium AS "lastMedium",
            v.last_campaign AS "lastCampaign",
            v.last_qr_code_id AS "lastQrCodeId"
       FROM mart_funnel_sessions s
       LEFT JOIN mart_visitor_attribution v ON v.visitor_id = s.visitor_id
      WHERE s.session_id = $1
      LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] ?? null;
}

async function buildCandidate(
  customer: CustomerRow,
  cart: CartRow,
  linkedBy: 'customer' | 'session' | 'campaign',
): Promise<RestoreOrderCandidate> {
  const warnings: string[] = [];
  const rawItems = parseItems(cart.items);
  const convertedAt = cart.convertedAt;
  const productIds = [...new Set(rawItems.map(item => String(item.productId || '')).filter(id => UUID_RE.test(id)))];

  const productResult = productIds.length
    ? await query<{ id: string; isBundle: boolean }>(
      `SELECT id, is_bundle AS "isBundle" FROM mart_products WHERE id = ANY($1::uuid[])`,
      [productIds]
    )
    : { rows: [] as Array<{ id: string; isBundle: boolean }> };
  const productMap = new Map(productResult.rows.map(row => [row.id, row]));

  const storeProductResult = productIds.length
    ? await query<{ productId: string; storeId: string }>(
      `SELECT product_id AS "productId", store_id AS "storeId"
         FROM mart_store_products
        WHERE product_id = ANY($1::uuid[])`,
      [productIds]
    )
    : { rows: [] as Array<{ productId: string; storeId: string }> };
  const storesByProduct = new Map<string, string[]>();
  for (const row of storeProductResult.rows) {
    const list = storesByProduct.get(row.productId) || [];
    list.push(row.storeId);
    storesByProduct.set(row.productId, list);
  }

  const itemStoreHints = rawItems.map(item => {
    const productId = String(item.productId || '');
    const sourceStoreId = typeof item.sourceStoreId === 'string' && UUID_RE.test(item.sourceStoreId)
      ? item.sourceStoreId
      : null;
    if (sourceStoreId) return sourceStoreId;
    const stores = storesByProduct.get(productId) || [];
    return stores.length === 1 ? stores[0] : null;
  });

  const distinctItemStores = [...new Set(itemStoreHints.filter((id): id is string => Boolean(id)))];
  let headStoreId: string | null = distinctItemStores.length === 1 ? distinctItemStores[0] : null;

  if (!headStoreId && distinctItemStores.length > 1) {
    const zoneResult = await query<{ storeId: string }>(
      `SELECT z.primary_store_id AS "storeId"
         FROM mart_zones z
         JOIN mart_zone_stores zs ON zs.zone_id = z.id
        WHERE z.primary_store_id IS NOT NULL
          AND zs.store_id = ANY($1::uuid[])
        GROUP BY z.id, z.primary_store_id
       HAVING COUNT(DISTINCT zs.store_id) = (SELECT COUNT(DISTINCT x) FROM unnest($1::uuid[]) AS x)
        LIMIT 1`,
      [distinctItemStores]
    );
    headStoreId = zoneResult.rows[0]?.storeId ?? distinctItemStores[0];
    warnings.push('Items came from more than one store; confirm the head store before restoring.');
  }

  if (!headStoreId && distinctItemStores.length === 0) {
    warnings.push('Could not determine the head store from the cart; choose one before restoring.');
  }

  const allStoreIds = [...new Set([headStoreId, ...itemStoreHints, ...distinctItemStores].filter((id): id is string => Boolean(id)))];
  const storeResult = allStoreIds.length
    ? await query<{ id: string; name: string }>(
      `SELECT id, name FROM mart_stores WHERE id = ANY($1::uuid[])`,
      [allStoreIds]
    )
    : { rows: [] as Array<{ id: string; name: string }> };
  const storeNames = new Map(storeResult.rows.map(row => [row.id, row.name]));

  const bundleKeys = [...new Set(rawItems.map((item, index) => {
    const productId = String(item.productId || '');
    const storeId = itemStoreHints[index] || headStoreId;
    return productMap.get(productId)?.isBundle && storeId ? `${storeId}:${productId}` : '';
  }).filter(Boolean))];
  const bundleStoreIds = [...new Set(bundleKeys.map(key => key.split(':')[0]))];
  const bundleIds = [...new Set(bundleKeys.map(key => key.split(':')[1]))];

  const bundleResult = bundleStoreIds.length && bundleIds.length
    ? await query<{ storeId: string; bundleProductId: string; productId: string; productName: string; unit: string; quantity: number }>(
      `SELECT bc.store_id AS "storeId",
              bc.bundle_product_id AS "bundleProductId",
              bc.component_product_id AS "productId",
              p.name AS "productName",
              COALESCE(bc.deduction_unit, sp.unit, '') AS unit,
              bc.quantity::float AS quantity
         FROM mart_bundle_components bc
         JOIN mart_products p ON p.id = bc.component_product_id
         JOIN mart_store_products sp
           ON sp.store_id = bc.store_id AND sp.product_id = bc.component_product_id
        WHERE bc.store_id = ANY($1::uuid[])
          AND bc.bundle_product_id = ANY($2::uuid[])`,
      [bundleStoreIds, bundleIds]
    )
    : { rows: [] as Array<{ storeId: string; bundleProductId: string; productId: string; productName: string; unit: string; quantity: number }> };
  const bundlesByKey = new Map<string, Array<{ productId: string; productName: string; unit: string; quantity: number }>>();
  for (const row of bundleResult.rows) {
    const key = `${row.storeId}:${row.bundleProductId}`;
    const list = bundlesByKey.get(key) || [];
    list.push({
      productId: row.productId,
      productName: row.productName,
      unit: row.unit,
      quantity: Number(row.quantity),
    });
    bundlesByKey.set(key, list);
  }

  const items: RestoreOrderItem[] = [];
  const expectedInventory = new Map<string, { productId: string; storeId: string }>();
  let itemSavings = 0;

  rawItems.forEach((item, index) => {
    const productId = String(item.productId || '');
    const exists = productMap.has(productId);
    const price = roundMoney(toNumber(item.price));
    const mrp = roundMoney(Math.max(price, toNumber(item.mrp, price)));
    const quantity = Math.max(0, Math.floor(toNumber(item.quantity)));
    const storeId = itemStoreHints[index] || headStoreId;
    const isBundle = productMap.get(productId)?.isBundle === true;
    const components = isBundle && storeId ? (bundlesByKey.get(`${storeId}:${productId}`) || []) : [];

    if (!exists) warnings.push(`Product ${item.productName || productId} no longer exists; the line will be restored without a catalogue link.`);
    if (isBundle && components.length === 0) warnings.push(`Combo ${item.productName || productId} has no current component definition; its stock will not be re-linked.`);

    itemSavings += Math.max(0, mrp - price) * quantity;

    if (storeId) {
      const componentRows = isBundle ? components : [{ productId, productName: String(item.productName || ''), unit: String(item.unit || ''), quantity: 1 }];
      for (const component of componentRows) {
        if (!UUID_RE.test(component.productId)) continue;
        expectedInventory.set(`${component.productId}:${storeId}`, { productId: component.productId, storeId });
      }
    }

    items.push({
      productId: exists ? productId : null,
      productName: String(item.productName || ''),
      unit: String(item.unit || ''),
      price,
      mrp,
      quantity,
      total: roundMoney(price * quantity),
      storeId,
      storeName: storeId ? (storeNames.get(storeId) || null) : null,
      missingProduct: !exists,
      bundleComponents: components,
    });
  });

  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
  const campaignUse = await findCampaignUse(customer.id, convertedAt);
  const funnel = await findFunnelMatch(cart.sessionId, convertedAt);
  const inventory = await findOrphanInventory(expectedInventory, convertedAt);

  if (!funnel?.orderNumber) warnings.push('No surviving order number was found; a new one will be generated.');
  if (!funnel) warnings.push('No order_placed funnel event was found for this cart.');
  if (!campaignUse) warnings.push('No unlinked campaign redemption was found for this order.');
  if (!inventory) warnings.push('No orphaned inventory deduction matched this cart; the original order id and stock link will not be reused.');

  const settings = headStoreId ? await SettingsService.getPublic(headStoreId) : {};
  const storeDeliveryCharge = roundMoney(toNumber(settings.delivery_charge));
  const freeAbove = roundMoney(toNumber(settings.free_delivery_above));
  let campaignDiscount = roundMoney(campaignUse?.discountApplied ?? 0);
  const recoveredTotal = funnel?.total != null && Number.isFinite(Number(funnel.total))
    ? roundMoney(Number(funnel.total))
    : null;

  let deliveryCharge: number;
  if (recoveredTotal != null) {
    if (campaignUse) {
      deliveryCharge = roundMoney(Math.max(0, recoveredTotal - subtotal + campaignDiscount));
    } else {
      const gap = roundMoney(recoveredTotal - subtotal);
      if (gap < 0) {
        campaignDiscount = roundMoney(-gap);
        deliveryCharge = 0;
        warnings.push(`The recovered total is below the cart subtotal; a discount of ₹${campaignDiscount} was inferred.`);
      } else {
        deliveryCharge = gap;
        if (deliveryCharge > storeDeliveryCharge) {
          warnings.push(`The recovered total implies a delivery charge of ₹${deliveryCharge}; verify it before restoring.`);
        }
      }
    }
  } else if (campaignUse?.discountType === 'free_delivery' || (freeAbove > 0 && subtotal >= freeAbove)) {
    deliveryCharge = 0;
  } else {
    deliveryCharge = storeDeliveryCharge;
  }

  const total = recoveredTotal != null
    ? recoveredTotal
    : Math.ceil(Math.max(0, subtotal + deliveryCharge - campaignDiscount));
  const freeDeliverySaving = deliveryCharge === 0 && storeDeliveryCharge > 0 ? storeDeliveryCharge : 0;
  const status: RestoreStatus = inventory ? 'delivered' : 'pending';
  const createdAt = funnel?.placedAt || campaignUse?.usedAt || convertedAt;
  const deliveredAt = status === 'delivered' ? (inventory?.deductedAt || createdAt) : null;
  const orderNumber = funnel?.orderNumber || await uniqueOrderNumber(query);

  if (cart.orderId) warnings.push('This cart is already linked to an order.');

  return {
    cartId: cart.id,
    sessionId: cart.sessionId,
    linkedBy,
    convertedAt,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    cartSubtotal: roundMoney(toNumber(cart.subtotal)),
    cartItemSignature: itemSignature(cart.items),
    guestName: customer.name?.trim() || 'Customer',
    guestAddress: customer.address?.trim() || '',
    latitude: null,
    longitude: null,
    items,
    campaignUse,
    funnel,
    inventory,
    suggestion: {
      orderNumber,
      status,
      storeId: headStoreId,
      storeName: headStoreId ? (storeNames.get(headStoreId) || null) : null,
      paymentMethod: 'cod',
      subtotal,
      deliveryCharge,
      campaignDiscount,
      total,
      itemSavings: roundMoney(itemSavings),
      freeDeliverySaving,
      storeDeliveryCharge,
      createdAt,
      deliveredAt,
      recoveredTotal,
    },
    warnings: [...new Set(warnings)],
    alreadyRestoredOrderId: cart.orderId,
  };
}

export class OrderRestoreService {
  static async lookup(phoneInput: string): Promise<RestoreLookupResult> {
    const phone = normalizePhone(phoneInput);
    const customerResult = await query<CustomerRow>(
      `SELECT id, phone, name, address
         FROM mart_customers
        WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
        LIMIT 1`,
      [phone]
    );
    const customer = customerResult.rows[0];
    if (!customer) return { customer: null, candidates: [], recentOrders: [] };

    const recentResult = await query<{
      id: string;
      orderNumber: string;
      status: string;
      total: number;
      createdAt: string;
    }>(
      `SELECT id, order_number AS "orderNumber", status, total::float, created_at AS "createdAt"
         FROM mart_orders
        WHERE customer_id = $1 OR RIGHT(regexp_replace(guest_phone, '\\D', '', 'g'), 10) = $2
        ORDER BY created_at DESC
        LIMIT 10`,
      [customer.id, phone]
    );

    const directCarts = await query<CartRow & { sessionCustomerId: string | null }>(
      `SELECT c.id, c.customer_id AS "customerId", c.session_id AS "sessionId", c.items,
              c.item_count AS "itemCount", c.subtotal::float,
              c.converted_at AS "convertedAt", c.order_id AS "orderId",
              s.customer_id AS "sessionCustomerId"
         FROM mart_carts c
         LEFT JOIN mart_funnel_sessions s ON s.session_id = c.session_id
        WHERE c.converted_at IS NOT NULL
          AND (c.customer_id = $1 OR s.customer_id = $1)
        ORDER BY c.converted_at DESC
        LIMIT 25`,
      [customer.id]
    );

    const campaignCarts = directCarts.rows.length < 25
      ? await query<CartRow & { sessionCustomerId: string | null }>(
        `SELECT c.id, c.customer_id AS "customerId", c.session_id AS "sessionId", c.items,
                c.item_count AS "itemCount", c.subtotal::float,
                c.converted_at AS "convertedAt", c.order_id AS "orderId",
                s.customer_id AS "sessionCustomerId"
           FROM mart_carts c
           LEFT JOIN mart_funnel_sessions s ON s.session_id = c.session_id
          WHERE c.converted_at IS NOT NULL
            AND c.customer_id IS NULL
            AND (s.customer_id IS NULL OR s.customer_id <> $1)
            AND EXISTS (
              SELECT 1 FROM mart_funnel_events e
               WHERE e.session_id = c.session_id AND e.event_name = 'order_placed'
            )
            AND EXISTS (
              SELECT 1 FROM mart_campaign_uses cu
               WHERE cu.customer_id = $1
                 AND cu.order_id IS NULL
                 AND cu.reversed_at IS NULL
                 AND ABS(EXTRACT(EPOCH FROM (cu.used_at - c.converted_at))) <= 21600
            )
          ORDER BY c.converted_at DESC
          LIMIT 10`,
        [customer.id]
      )
      : { rows: [] as Array<CartRow & { sessionCustomerId: string | null }> };

    const seen = new Set<string>();
    const candidates: RestoreOrderCandidate[] = [];
    for (const cart of [...directCarts.rows, ...campaignCarts.rows]) {
      if (seen.has(cart.id)) continue;
      seen.add(cart.id);
      const linkedBy = cart.customerId === customer.id
        ? 'customer'
        : cart.sessionCustomerId === customer.id
          ? 'session'
          : 'campaign';
      const candidate = await buildCandidate(customer, cart, linkedBy);
      const addressResult = await query<{ latitude: number | null; longitude: number | null }>(
        `SELECT latitude, longitude
           FROM mart_customer_addresses
          WHERE customer_id = $1
          ORDER BY is_default DESC, created_at DESC
          LIMIT 1`,
        [customer.id]
      );
      candidate.latitude = parseCoordinates(addressResult.rows[0]?.latitude);
      candidate.longitude = parseCoordinates(addressResult.rows[0]?.longitude);
      candidates.push(candidate);
    }

    return {
      customer: {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        address: customer.address,
      },
      candidates,
      recentOrders: recentResult.rows.map(row => ({ ...row, total: roundMoney(toNumber(row.total)) })),
    };
  }

  static async restore(input: RestoreOrderInput, actor: RestoreOrderActor) {
    const phone = normalizePhone(input.phone);
    if (!input.cartId) throw badRequest('Choose a cart to restore');
    if (!isRestoreStatus(input.status)) throw badRequest('Choose a valid order status');
    const paymentMethod: RestorePaymentMethod = input.paymentMethod ?? 'cod';
    if (!isPaymentMethod(paymentMethod)) throw badRequest('Choose a valid payment method');
    const requestedOrderNumber = input.orderNumber?.trim();
    if (requestedOrderNumber && !/^MRT[0-9]{6}[A-Z0-9]{4}$/.test(requestedOrderNumber)) {
      throw badRequest('Choose a valid order number');
    }

    const lookup = await this.lookup(phone);
    if (!lookup.customer) throw notFound('No customer found for this phone number');
    const candidate = lookup.candidates.find(row => row.cartId === input.cartId);
    if (!candidate) throw notFound('This cart no longer matches the phone number');
    if (candidate.alreadyRestoredOrderId) throw conflict('This cart is already linked to an order');
    if (candidate.items.length === 0) throw badRequest('This cart has no items to restore');

    const guestName = (input.guestName ?? candidate.guestName).trim();
    const guestAddress = (input.guestAddress ?? candidate.guestAddress).trim();
    if (!guestName) throw badRequest('Customer name is required');
    if (!guestAddress) throw badRequest('Delivery address is required');

    const storeId = input.storeId || candidate.suggestion.storeId;
    if (!storeId) throw badRequest('Choose the head store for this order');
    const storeResult = await query<{ id: string; name: string }>(
      `SELECT id, name FROM mart_stores WHERE id = $1 LIMIT 1`,
      [storeId]
    );
    const store = storeResult.rows[0];
    if (!store) throw badRequest('Choose a valid store');

    const subtotal = candidate.suggestion.subtotal;
    const campaignDiscount = candidate.suggestion.campaignDiscount;
    const storeChanged = storeId !== candidate.suggestion.storeId;
    let storeDeliveryCharge = candidate.suggestion.storeDeliveryCharge;
    let storeFreeAbove = 0;
    if (storeChanged) {
      const settings = await SettingsService.getPublic(storeId);
      storeDeliveryCharge = roundMoney(toNumber(settings.delivery_charge));
      storeFreeAbove = roundMoney(toNumber(settings.free_delivery_above));
    }
    let deliveryCharge: number;
    if (input.deliveryCharge != null) {
      deliveryCharge = roundMoney(Math.max(0, toNumber(input.deliveryCharge)));
    } else if (!storeChanged) {
      deliveryCharge = candidate.suggestion.deliveryCharge;
    } else {
      deliveryCharge = candidate.campaignUse?.discountType === 'free_delivery'
        || (storeFreeAbove > 0 && subtotal >= storeFreeAbove)
        ? 0
        : storeDeliveryCharge;
    }
    const total = input.deliveryCharge != null || storeChanged
      ? Math.ceil(Math.max(0, subtotal + deliveryCharge - campaignDiscount))
      : candidate.suggestion.total;
    const freeDeliverySaving = deliveryCharge === 0 && storeDeliveryCharge > 0
      ? storeDeliveryCharge
      : 0;
    const itemSavings = candidate.suggestion.itemSavings;
    const createdAt = candidate.suggestion.createdAt;
    const deliveredAt = input.status === 'delivered'
      ? (candidate.suggestion.deliveredAt || new Date().toISOString())
      : null;

    const customer = lookup.customer;
    const attribution = await findAttribution(candidate.sessionId);
    const fulfilmentStores = [...new Set(candidate.items.map(item => item.storeId || storeId))];
    const warnings: string[] = [];

    return transaction(async client => {
      const cartResult = await client.query(
        `SELECT id, customer_id AS "customerId", session_id AS "sessionId", items,
                converted_at AS "convertedAt", order_id AS "orderId"
           FROM mart_carts
          WHERE id = $1
          FOR UPDATE`,
        [input.cartId]
      );
      const cart = cartResult.rows[0];
      if (!cart) throw notFound('Cart not found');
      if (cart.orderId) throw conflict('This cart is already linked to an order');
      if (cart.customerId && cart.customerId !== customer.id) {
        throw badRequest('This cart does not belong to the selected customer');
      }
      if (itemSignature(cart.items) !== candidate.cartItemSignature) {
        throw conflict('The cart changed since it was previewed. Run the lookup again.');
      }

      if (candidate.inventory?.originalOrderId) {
        const existingOrder = await client.query(
          `SELECT 1 FROM mart_orders WHERE id = $1 LIMIT 1`,
          [candidate.inventory.originalOrderId]
        );
        if (existingOrder.rows.length) throw conflict('The original order already exists');
      }

      let orderNumber = requestedOrderNumber || candidate.suggestion.orderNumber;
      if (!orderNumber) orderNumber = await uniqueOrderNumber(client.query.bind(client));
      const numberTaken = await client.query(
        `SELECT 1 FROM mart_orders WHERE order_number = $1 LIMIT 1`,
        [orderNumber]
      );
      if (numberTaken.rows.length) {
        warnings.push(`Order number ${orderNumber} was already in use; a new number was generated.`);
        orderNumber = await uniqueOrderNumber(client.query.bind(client));
      }

      const orderId = candidate.inventory?.originalOrderId || uuidv4();
      const trackingToken = uuidv4();
      const campaignUse = candidate.campaignUse;

      await client.query(
        `INSERT INTO mart_orders
           (id, order_number, store_id, customer_id, guest_name, guest_phone, guest_address,
            delivery_latitude, delivery_longitude,
            subtotal, delivery_charge, total, payment_method, notes,
            delivery_preference, delivery_note, fulfilled_by, fulfilled_by_detail,
            campaign_id, campaign_discount, coupon_code_used,
            item_savings, free_delivery_saving,
            placed_outside_hours, closed_reason, scheduled_for,
            tracking_token, delivered_at,
            funnel_session_id, funnel_visitor_id,
            attribution_source, attribution_medium, attribution_campaign, attribution_qr_code_id,
            first_touch_source, first_touch_medium, first_touch_campaign, first_touch_qr_code_id,
            last_touch_source, last_touch_medium, last_touch_campaign, last_touch_qr_code_id,
            discount_amount, created_at, updated_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,$22,$23,false,NULL,NULL,$24,$25,
                 $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,0,$40,NOW(),$41)`,
        [
          orderId, orderNumber, storeId, customer.id, guestName, phone, guestAddress,
          candidate.latitude, candidate.longitude,
          subtotal, deliveryCharge, total, paymentMethod, input.notes?.trim() || null,
          'within_15', 'Ring the bell', store.name,
          fulfilmentStores.map(id => storeNamesFromCandidate(candidate, id, store.name)).join(', '),
          campaignUse?.campaignId || null, campaignDiscount,
          campaignUse?.couponCodeUsed || campaignUse?.couponCode || null,
          itemSavings, freeDeliverySaving,
          trackingToken, deliveredAt,
          attribution?.sessionId || candidate.sessionId,
          attribution?.visitorId || null,
          attribution?.source || null,
          attribution?.medium || null,
          attribution?.utmCampaign || null,
          attribution?.qrCodeId || null,
          attribution?.firstSource || null,
          attribution?.firstMedium || null,
          attribution?.firstCampaign || null,
          attribution?.firstQrCodeId || null,
          attribution?.lastSource || null,
          attribution?.lastMedium || null,
          attribution?.lastCampaign || null,
          attribution?.lastQrCodeId || null,
          createdAt, input.status,
        ]
      );

      for (const item of candidate.items) {
        const orderItemId = uuidv4();
        const itemStoreId = item.storeId || storeId;
        await client.query(
          `INSERT INTO mart_order_items
             (id, order_id, store_id, product_id, product_name, unit, price, quantity, total, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orderItemId, orderId, itemStoreId, item.productId, item.productName,
            item.unit, item.price, item.quantity, item.total, createdAt,
          ]
        );
        for (const component of item.bundleComponents) {
          await client.query(
            `INSERT INTO mart_order_item_bundle_components
               (order_item_id, component_product_id, product_name, unit, quantity_per_bundle)
             VALUES ($1,$2,$3,$4,$5)`,
            [orderItemId, component.productId, component.productName, component.unit, component.quantity]
          );
        }
      }

      const fulfilmentStatus = input.status === 'delivered'
        ? 'delivered'
        : ['cancelled', 'terminated', 'failed_delivery'].includes(input.status)
          ? 'cancelled'
          : 'pending';

      for (const fulfilmentStoreId of fulfilmentStores) {
        await client.query(
          `INSERT INTO mart_order_store_fulfilments
             (order_id, store_id, status, delivered_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (order_id, store_id) DO NOTHING`,
          [orderId, fulfilmentStoreId, fulfilmentStatus, fulfilmentStatus === 'delivered' ? deliveredAt : null]
        );
      }

      await client.query(
        `INSERT INTO mart_order_status_events
           (order_id, from_status, to_status, actor_id, actor_name, created_at)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
        [orderId, input.status, actor.id, `${actor.username} (restore)`, deliveredAt || new Date().toISOString()]
      );

      if (campaignUse) {
        const linked = await client.query(
          `UPDATE mart_campaign_uses
              SET order_id = $1
            WHERE id = $2 AND order_id IS NULL
            RETURNING id`,
          [orderId, campaignUse.id]
        );
        if (!linked.rows.length) {
          warnings.push('The campaign redemption was already linked elsewhere and was not re-linked.');
        }
      }

      const cartLinked = await client.query(
        `UPDATE mart_carts
            SET order_id = $1,
                converted_at = COALESCE(converted_at, $2)
          WHERE id = $3 AND order_id IS NULL
          RETURNING id`,
        [orderId, createdAt, input.cartId]
      );
      if (!cartLinked.rows.length) throw conflict('This cart was linked to another order while restoring');

      return {
        orderId,
        orderNumber,
        status: input.status,
        total,
        storeId,
        storeName: store.name,
        cartId: input.cartId,
        campaignUseId: campaignUse?.id || null,
        originalOrderIdReused: Boolean(candidate.inventory?.originalOrderId),
        warnings,
      };
    });
  }
}

function storeNamesFromCandidate(candidate: RestoreOrderCandidate, storeId: string, fallback: string): string {
  const item = candidate.items.find(row => row.storeId === storeId && row.storeName);
  return item?.storeName || fallback;
}
