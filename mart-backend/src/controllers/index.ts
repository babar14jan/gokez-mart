import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { asyncHandler, AdminRequest, ADMIN_TOKEN_TYPE, isValidAdminRole, ADMIN_ROLE_LIST } from '../middleware';
import { ProductService } from '../services/product.service';
import { CategoryService } from '../services/category.service';
import { OrderService } from '../services/order.service';
import { SettingsService } from '../services/settings.service';
import { ZoneService } from '../services/zone.service';
import { StoreService } from '../services/store.service';
import { TeamService } from '../services/team.service';
import { CustomerAuthService } from '../services/customerAuth.service';
import { CustomerRequest } from '../middleware';
import { PushService } from '../services/push.service';
import { ComplianceService } from '../services/compliance.service';
import { query, transaction } from '../database/db';
import { InventoryService } from '../services/inventory.service';
import { CampaignService } from '../services/campaign.service';
import { CustomerLeadService, LeadStatus } from '../services/customerLead.service';
import { FunnelService, FunnelRange } from '../services/funnel.service';
import { FunnelEventService, FunnelEventName } from '../services/funnelEvent.service';
import { FunnelCartService } from '../services/funnelCart.service';
import { evaluateStoreOpen } from '../utils/storeHours';
import { config } from '../config';

const SHAPOORJI_ID = '00000000-0000-0000-0000-000000000001';

type PreparedImage = { buffer: Buffer; extension: string; mimeType: string };

function hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  if (latitude == null && longitude == null) return true;
  return typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

async function prepareImage(buffer: Buffer, maxDimension: number): Promise<PreparedImage> {
  const image = sharp(buffer, { failOn: 'error' }).rotate().resize({
    width: maxDimension,
    height: maxDimension,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const metadata = await image.metadata();

  if (metadata.format === 'jpeg' || metadata.format === 'png' || metadata.format === 'webp') {
    return {
      buffer: await image.webp({ quality: 82, effort: 4 }).toBuffer(),
      extension: 'webp',
      mimeType: 'image/webp',
    };
  }
  throw new Error('Only JPEG, PNG, and WebP images are supported');
}

// Helper: resolve storeId from request (admin JWT or query param storeId)
function resolveStoreId(req: AdminRequest): string {
  // Store manager → always their store
  if (req.admin?.storeId) return req.admin.storeId;
  // Super admin → can pass storeId in query or body
  return (req.query.storeId || req.body?.storeId || SHAPOORJI_ID) as string;
}

// ── Public controllers ────────────────────────────────────────────────────────

export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await CategoryService.findAll(true);
  res.json({ success: true, data: categories });
});

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const { categoryId, storeId } = req.query;
  const products = await ProductService.findAll({
    storeId: (storeId as string) || SHAPOORJI_ID,
    categoryId: categoryId as string,
    excludeHidden: true,
  });
  res.json({ success: true, data: products });
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.query;
  const product = await ProductService.findById(req.params.id, storeId as string);
  if (!product) { res.status(404).json({ success: false, error: 'Product not found' }); return; }
  res.json({ success: true, data: product });
});

export const getPublicSettings = asyncHandler(async (req: Request, res: Response) => {
  const storeId = (req.query.storeId as string) || SHAPOORJI_ID;
  const settings = await SettingsService.getPublic(storeId);
  // Open/closed is computed here rather than in the browser so there is exactly
  // one implementation of the schedule, and so the answer cannot depend on the
  // customer's device clock or timezone. The storefront re-fetches at
  // nextOpenAt to pick up the change instead of re-deriving it locally.
  const store = await StoreService.findById(storeId);
  const openState = evaluateStoreOpen(store?.openingHours, settings.store_open);
  res.json({ success: true, data: { ...settings, openState } });
});

export const reverseGeocode = asyncHandler(async (req: Request, res: Response) => {
  const { latitude, longitude } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    res.status(400).json({ success: false, error: 'Valid latitude and longitude are required' }); return;
  }

  const url = new URL('/reverse', config.geocoding.baseUrl);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': config.geocoding.userAgent, Accept: 'application/json', 'Accept-Language': 'en' },
    });
    if (!response.ok) throw new Error(`Reverse geocoding failed: ${response.status}`);
    const result: any = await response.json();
    const address = result.address || {};
    res.json({
      success: true,
      data: {
        house: address.house_number || '',
        building: address.building || '',
        locality: address.road || address.neighbourhood || address.suburb || address.village || '',
        city: address.city || address.town || address.village || address.county || '',
        pincode: address.postcode || '',
      },
    });
  } catch {
    res.status(503).json({ success: false, error: 'Could not look up this location. Please enter your address manually.' });
  }
});

export const placeOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { guestName, guestPhone, guestAddress, guestAddressLabel, items, paymentMethod, notes, storeId, zoneName, deliveryPreference, deliveryNote, campaignId, couponCode, latitude, longitude } = req.body;
  const normalizedName = typeof guestName === 'string' ? guestName.trim().replace(/\s+/g, ' ') : '';
  const normalizedAddress = typeof guestAddress === 'string' ? guestAddress.trim() : '';
  if (!normalizedName || !guestPhone || !normalizedAddress || !items?.length || !paymentMethod) {
    res.status(400).json({ success: false, error: 'Missing required fields' });
    return;
  }
  const cleanPhone = String(guestPhone).replace(/\D/g, '');
  if (normalizedName.length < 2 || normalizedName.length > 80 || !/\p{L}/u.test(normalizedName)) {
    res.status(400).json({ success: false, error: 'Enter a valid name' }); return;
  }
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) { res.status(400).json({ success: false, error: 'Invalid phone number' }); return; }
  if (normalizedAddress.length < 10 || normalizedAddress.length > 500) {
    res.status(400).json({ success: false, error: 'Enter a complete delivery address' }); return;
  }
  if (!['cod', 'upi', 'phonepay'].includes(paymentMethod)) { res.status(400).json({ success: false, error: 'Invalid payment method' }); return; }
  if (!Array.isArray(items) || !items.every((i: any) => i.productId && i.unit && Number.isInteger(i.quantity) && i.quantity > 0)) {
    res.status(400).json({ success: false, error: 'Invalid items' }); return;
  }
  const hasCoordinates = latitude != null || longitude != null;
  if (!hasValidCoordinates(latitude, longitude)) {
    res.status(400).json({ success: false, error: 'Invalid delivery coordinates' }); return;
  }
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length > 128) {
    res.status(400).json({ success: false, error: 'A valid Idempotency-Key is required' }); return;
  }
  // Optional, and only ever used to close the cart funnel. It is a client-chosen
  // string, so it is validated and length-capped rather than trusted; a bad value
  // is dropped instead of failing the order, because analytics must never be the
  // reason a customer cannot check out.
  const funnelSessionId = typeof req.body.funnelSessionId === 'string'
    ? req.body.funnelSessionId.trim().slice(0, 64) || null
    : null;
  if (campaignId && couponCode) {
    res.status(400).json({ success: false, error: 'Select either an offer or a coupon code, not both' }); return;
  }
  if ((campaignId || couponCode) && (!req.customer || req.customer.phone !== cleanPhone)) {
    res.status(401).json({ success: false, error: 'Sign in with the ordering phone number to redeem an offer' }); return;
  }
  // Fetch store name for fulfilled_by
  const storeResult = await query<{ name: string }>(`SELECT name FROM mart_stores WHERE id = $1`, [storeId || SHAPOORJI_ID]);
  const storeName = storeResult.rows[0]?.name || 'Gokez Mart';

  const result = await OrderService.create({
    guestName: normalizedName, guestPhone: cleanPhone, guestAddress: normalizedAddress, items, paymentMethod, notes,
    guestAddressLabel: typeof guestAddressLabel === 'string' && guestAddressLabel.trim()
      ? guestAddressLabel.trim().slice(0, 24)
      : undefined,
    storeId: storeId || SHAPOORJI_ID,
    storeName,
    zoneName, deliveryPreference, deliveryNote,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    campaignId: campaignId || null,
    couponCodeUsed: couponCode || null,
    customerId: req.customer?.id || null,
    funnelSessionId,
    idempotencyKey,
  });

  if (!result.duplicate) PushService.notifyStoreAdmins(storeId || SHAPOORJI_ID, {
    title: `New Order #${result.orderNumber}`,
    body: `${guestName} placed an order for ₹${result.total}`,
    url: '/orders',
    tag: `order-${result.orderId}`,
  }).catch(() => {});
  const customer = await query<{ customer_id: string | null }>(`SELECT customer_id FROM mart_orders WHERE id = $1`, [result.orderId]);
  if (!result.duplicate && customer.rows[0]?.customer_id) {
    PushService.notifyCustomer(customer.rows[0].customer_id, {
      title: `Order #${result.orderNumber} received`,
      body: `Order #${result.orderNumber} has been received.`,
      url: '/orders',
      tag: `order-${result.orderId}`,
    }).catch(() => {});
  }
  res.status(201).json({ success: true, data: result });
});

export const trackOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const orders = await OrderService.trackByPhone(req.customer!.phone);
  res.json({ success: true, data: orders });
});

// Removed: the public phone-only lookup (GET /orders/track/guest). It returned
// up to 10 orders for any phone number with no proof of ownership, so anyone
// could read another shopper's addresses, items and totals. Guests now track via
// unguessable per-order tracking tokens in GET /orders/track/tokens, and
// cross-device history requires OTP via authenticateCustomer on /orders/track.

export const trackGuestOrdersByTokens = asyncHandler(async (req: Request, res: Response) => {
  const { tokens } = req.query;
  if (!tokens || typeof tokens !== 'string') {
    res.status(400).json({ success: false, error: 'Tokens required' });
    return;
  }
  const tokenList = tokens.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 20);
  if (!tokenList.length) {
    res.status(400).json({ success: false, error: 'Valid tokens required' });
    return;
  }
  const orders = await OrderService.trackByTokens(tokenList);
  res.json({ success: true, data: orders });
});

// ── Public stores + zones ─────────────────────────────────────────────────────

export const getZones = asyncHandler(async (_req: Request, res: Response) => {
  const zones = await ZoneService.findAll(true);
  res.json({ success: true, data: zones });
});

export const getStores = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await StoreService.findAll();
  res.json({ success: true, data: stores.filter(s => s.isActive) });
});

// ── Admin auth ────────────────────────────────────────────────────────────────

export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const result = await query<{
    id: string; username: string; password_hash: string;
    name: string | null; email: string | null; phone: string | null;
    role: string; store_id: string | null; is_active: boolean;
  }>(
    `SELECT id, username, password_hash, name, email, phone, role, store_id, is_active
     FROM mart_admins WHERE username = $1`, [username]
  );
  const admin = result.rows[0];
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    // Audit failed login
    ComplianceService.logAudit({
      username, action: 'login', detail: `Failed login attempt`,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], status: 'failed',
    }).catch(() => {});
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }
  if (!admin.is_active) {
    res.status(403).json({ success: false, error: 'Your account has been deactivated. Contact your administrator.' });
    return;
  }
  await query(`UPDATE mart_admins SET last_login_at = NOW() WHERE id = $1`, [admin.id]);
  // Audit log
  ComplianceService.logAudit({
    adminId: admin.id, username: admin.username, role: admin.role,
    action: 'login', detail: `Login from ${req.ip}`,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
  const jti = require('uuid').v4();
  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role, type: ADMIN_TOKEN_TYPE, storeId: admin.store_id, jti },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as any
  );

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO mart_admin_sessions (admin_id, token_jti, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [admin.id, jti, req.ip || null, req.headers['user-agent'] || null, expiresAt]
  );

  const activeSessions = await query(
    `SELECT id FROM mart_admin_sessions WHERE admin_id = $1 AND is_active = true AND expires_at > NOW() ORDER BY created_at DESC`,
    [admin.id]
  );

  if (activeSessions.rows.length > 2) {
    const sessionsToRevoke = activeSessions.rows.slice(2);
    for (const session of sessionsToRevoke) {
      await query(`UPDATE mart_admin_sessions SET is_active = false, revoked_at = NOW() WHERE id = $1`, [session.id]);
    }
  }

  res.json({ success: true, data: {
    token,
    id: admin.id,
    username: admin.username,
    name: admin.name || admin.username,
    email: admin.email,
    phone: admin.phone,
    role: admin.role,
    storeId: admin.store_id,
  }});
});

export const adminLogout = asyncHandler(async (req: AdminRequest, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, config.jwt.secret) as any;
      await query(
        `UPDATE mart_admin_sessions SET is_active = false, revoked_at = NOW() WHERE token_jti = $1`,
        [payload.jti]
      );
    } catch {}
  }
  res.json({ success: true });
});

export const adminGetMe = asyncHandler(async (req: AdminRequest, res: Response) => {
  const result = await query(
    `SELECT id, username, name, email, phone, role, store_id as "storeId", last_login_at, created_at
     FROM mart_admins WHERE id = $1`,
    [req.admin!.id]
  );
  if (!result.rows[0]) { res.status(404).json({ success: false, error: 'Admin not found' }); return; }
  res.json({ success: true, data: result.rows[0] });
});

export const adminUpdateProfile = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, email, phone } = req.body;
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  await query(
    `UPDATE mart_admins SET name = $1, email = $2, phone = $3, updated_at = NOW() WHERE id = $4`,
    [name.trim(), email?.trim() || null, phone?.trim() || null, req.admin!.id]
  );
  const result = await query(
    `SELECT name, email, phone, role, store_id as "storeId", last_login_at FROM mart_admins WHERE id = $1`,
    [req.admin!.id]
  );
  res.json({ success: true, data: result.rows[0] });
});

export const adminChangePassword = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) { res.status(400).json({ success: false, error: 'Both passwords required' }); return; }
  if (newPassword.length < 8) { res.status(400).json({ success: false, error: 'Password must be at least 8 characters' }); return; }
  const result = await query<{ password_hash: string }>(`SELECT password_hash FROM mart_admins WHERE id = $1`, [req.admin!.id]);
  if (!result.rows[0] || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
    res.status(401).json({ success: false, error: 'Current password is incorrect' }); return;
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE mart_admins SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, req.admin!.id]);
  res.json({ success: true, message: 'Password changed successfully' });
});

// ── Admin product controllers ─────────────────────────────────────────────────

export const adminGetProducts = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const products = await ProductService.findAll({ storeId });
  res.json({ success: true, data: products });
});

export const adminCreateProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const product = await ProductService.create({ ...req.body, storeId });
  res.status(201).json({ success: true, data: product });
});

export const adminUpdateProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const product = await ProductService.update(req.params.id, { ...req.body, storeId });
  if (!product) { res.status(404).json({ success: false, error: 'Product not found' }); return; }
  res.json({ success: true, data: product });
});

export const adminDeleteProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  await ProductService.delete(req.params.id);
  res.json({ success: true, message: 'Product deleted' });
});

// ── Master catalog ────────────────────────────────────────────────────────────

// Browse catalog — all authenticated roles
export const adminGetCatalog = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { categoryId, search } = req.query;
  const conditions: string[] = ['p.is_catalog = true'];
  const params: unknown[] = [];
  let i = 1;
  if (categoryId) { conditions.push(`p.category_id = $${i++}`); params.push(categoryId); }
  if (search) { conditions.push(`p.name ILIKE $${i++}`); params.push(`%${search}%`); }
  const result = await query(
    `SELECT p.id, p.name, p.local_name as "localName", p.description,
            p.photo_url as "photoUrl", p.category_id as "categoryId",
            c.name as "categoryName", c.icon as "categoryIcon"
     FROM mart_products p
     LEFT JOIN mart_categories c ON c.id = p.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.sort_order ASC NULLS LAST, p.name ASC`,
    params
  );
  res.json({ success: true, data: result.rows });
});

// Create catalog product — super_admin only (name + photo + category, no price/store)
export const adminCreateCatalogProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, localName, description, photoUrl, categoryId } = req.body;
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'name is required' }); return; }
  const product = await ProductService.createCatalogProduct({ name: name.trim(), localName, description, photoUrl, categoryId });
  res.status(201).json({ success: true, data: product });
});

// Update catalog product — super_admin only
export const adminUpdateCatalogProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, localName, description, photoUrl, categoryId } = req.body;
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (name !== undefined)        { fields.push(`name = $${i++}`);        params.push(name); }
  if (localName !== undefined)   { fields.push(`local_name = $${i++}`);  params.push(localName); }
  if (description !== undefined) { fields.push(`description = $${i++}`); params.push(description); }
  if (photoUrl !== undefined)    { fields.push(`photo_url = $${i++}`);   params.push(photoUrl); }
  if (categoryId !== undefined)  { fields.push(`category_id = $${i++}`); params.push(categoryId || null); }
  if (!fields.length) { res.status(400).json({ success: false, error: 'Nothing to update' }); return; }
  fields.push(`updated_at = NOW()`);
  params.push(req.params.id);
  const result = await query(
    `UPDATE mart_products SET ${fields.join(', ')} WHERE id = $${i} AND is_catalog = true
     RETURNING id, name, local_name as "localName", description, photo_url as "photoUrl", category_id as "categoryId"`,
    params
  );
  if (!result.rows[0]) { res.status(404).json({ success: false, error: 'Catalog product not found' }); return; }
  res.json({ success: true, data: result.rows[0] });
});

// Delete catalog product — super_admin only, blocked if used in any store
export const adminDeleteCatalogProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const check = await query(
    `SELECT COUNT(*) as cnt FROM mart_store_products WHERE product_id = $1`, [req.params.id]
  );
  if (parseInt(check.rows[0].cnt) > 0) {
    res.status(400).json({ success: false, error: 'Cannot delete — product is used in one or more stores' });
    return;
  }
  await query(`DELETE FROM mart_products WHERE id = $1 AND is_catalog = true`, [req.params.id]);
  res.json({ success: true, message: 'Catalog product deleted' });
});

// Bulk add from catalog — creates store products with name+photo only, hidden by default
export const adminBulkAddFromCatalog = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { productIds } = req.body; // array of catalog product IDs
  if (!Array.isArray(productIds) || productIds.length === 0) {
    res.status(400).json({ success: false, error: 'productIds array required' }); return;
  }
  // For each catalog product, create a store_product entry with placeholder price=0, hidden
  for (const productId of productIds) {
    await query(
      `INSERT INTO mart_store_products (store_id, product_id, price, unit, discount_percent, availability_status, is_available)
       VALUES ($1, $2, 0, '1 kg', 0, 'hidden', false)
       ON CONFLICT (store_id, product_id) DO NOTHING`,
      [storeId, productId]
    );
  }
  res.json({ success: true, message: `${productIds.length} product(s) added to store. Set price and availability to make them live.` });
});

// ── Admin category controllers ────────────────────────────────────────────────

export const adminGetCategories = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const categories = await CategoryService.findAll();
  res.json({ success: true, data: categories });
});

export const adminCreateCategory = asyncHandler(async (req: AdminRequest, res: Response) => {
  const category = await CategoryService.create(req.body);
  res.status(201).json({ success: true, data: category });
});

export const adminUpdateCategory = asyncHandler(async (req: AdminRequest, res: Response) => {
  const category = await CategoryService.update(req.params.id, req.body);
  if (!category) { res.status(404).json({ success: false, error: 'Category not found' }); return; }
  res.json({ success: true, data: category });
});

export const adminDeleteCategory = asyncHandler(async (req: AdminRequest, res: Response) => {
  await CategoryService.delete(req.params.id);
  res.json({ success: true, message: 'Category deleted' });
});

// ── Admin order controllers ───────────────────────────────────────────────────

export const adminGetOrders = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { status, phone, limit, offset } = req.query;
  const orders = await OrderService.findAll({
    storeId,
    status: status as string,
    phone: phone as string,
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0,
  });
  res.json({ success: true, data: orders });
});

// ── Batch dispatch ────────────────────────────────────────────────────────────────────
// Marks multiple orders as out_for_delivery in one tap, assigns sequence + batch_id
export const adminBatchDispatch = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { orderIds } = req.body; // array of order IDs in delivery sequence
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    res.status(400).json({ success: false, error: 'orderIds array required' }); return;
  }
  const adminResult = await query<{ name: string | null; phone: string | null }>(
    `SELECT name, phone FROM mart_admins WHERE id = $1`, [req.admin!.id]
  );
  const admin = adminResult.rows[0];
  const batchId = require('uuid').v4();

  for (let i = 0; i < orderIds.length; i++) {
    await query(
      `UPDATE mart_orders SET
         status = 'out_for_delivery',
         delivery_by = $1,
         delivery_by_name = $2,
         delivery_by_phone = $3,
         delivery_sequence = $4,
         batch_id = $5,
         updated_at = NOW()
       WHERE id = $6`,
      [req.admin!.id, admin?.name || req.admin!.username, admin?.phone || null, i + 1, batchId, orderIds[i]]
    );
    // Notify each customer
    const custResult = await query<{ customer_id: string | null; delivery_preference: string }>(
      `SELECT customer_id, delivery_preference FROM mart_orders WHERE id = $1`, [orderIds[i]]
    );
    const { customer_id, delivery_preference } = custResult.rows[0] || {};
    const etaLabel = delivery_preference === 'within_30' ? '30 mins' : delivery_preference === 'within_60' ? '1 hour' : '10-15 mins';
    if (customer_id) {
      PushService.notifyCustomer(customer_id, {
        title: 'Rider is on the way',
        body: `🛵 Rider is on the way! Should reach you within ${etaLabel}`,
        url: '/orders',
      }).catch(() => {});
    }
  }
  res.json({ success: true, message: `${orderIds.length} order(s) dispatched`, batchId });
});

export const adminUpdateOrderStatus = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { status, failureReason, cancellationReason, deliveryAssigneeId } = req.body;
  const order = await OrderService.transitionStatus(req.params.id, status, req.admin!, deliveryAssigneeId, cancellationReason);
  if (status === 'failed_delivery' && failureReason) await query(`UPDATE mart_orders SET failure_reason = $1 WHERE id = $2`, [failureReason, req.params.id]);
  if (status === 'cancelled' && cancellationReason) await query(`UPDATE mart_orders SET cancellation_reason = $1 WHERE id = $2`, [cancellationReason, req.params.id]);

  const details = await query<{ customer_id: string | null; guest_name: string; store_name: string; delivery_by: string | null }>(
    `SELECT o.customer_id, o.guest_name, COALESCE(s.name, 'Gokez Mart') as store_name, o.delivery_by
     FROM mart_orders o LEFT JOIN mart_stores s ON s.id = o.store_id WHERE o.id = $1`, [req.params.id]
  );
  const detail = details.rows[0];
  const messages: Record<string, string> = {
    confirmed: 'Your order has been confirmed.',
    preparing: 'Your order is being prepared.',
    out_for_delivery: `Order picked up by ${order.deliveryByName || req.admin!.username} and on the way to you.`,
    delivered: 'Your order has been delivered.',
    cancelled: cancellationReason === 'outside_area'
      ? 'We are sorry, but your delivery address is currently outside our service area. You will not be charged. We are expanding soon and hope to serve your area very soon.'
      : 'Your order has been cancelled. You will not be charged.',
    failed_delivery: 'We could not complete delivery. Please contact support if you need help.',
  };
  const tag = `order-${order.id}`;
  if (status === 'ready_to_pickup' && detail?.delivery_by) {
    PushService.notifyAdmin(detail.delivery_by, {
      title: `Gokez Mart · Order #${order.orderNumber} ready for pickup`,
      body: `${detail.guest_name} · ready to collect and deliver`,
      url: '/delivery', tag,
    }).catch(() => {});
  }
  if (detail?.customer_id && messages[status]) {
    PushService.notifyCustomer(detail.customer_id, {
      title: `Order #${order.orderNumber} update`,
      body: messages[status], url: '/orders', tag,
    }).catch(() => {});
  }
  if (status === 'failed_delivery') {
    PushService.notifyStoreAdmins(order.storeId, {
      title: `Gokez Mart · Delivery failed · Order #${order.orderNumber}`,
      body: `${detail?.guest_name || 'Customer'} · ${failureReason || 'Delivery failed'}`,
      url: '/orders', tag,
    }).catch(() => {});
  }
  res.json({ success: true, data: order });
});


// ── Admin terminate order (super_admin + store_owner) ──────────────────────
export const adminTerminateOrder = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { reason, customReason } = req.body;
  if (!reason) { res.status(400).json({ success: false, error: 'Termination reason required' }); return; }
  if (reason === 'outside_area') { res.status(400).json({ success: false, error: 'Outside delivery area can only be selected before confirming an order' }); return; }
  const finalReason = reason === 'other' ? (customReason?.trim() || 'Other') : reason;
  const existing = await query<{ status: string; customer_id: string | null; store_id: string | null; order_number: string; guest_name: string }>(
    `SELECT status, customer_id, store_id, order_number, guest_name FROM mart_orders WHERE id = $1`, [req.params.id]
  );
  const ord = existing.rows[0];
  if (!ord) { res.status(404).json({ success: false, error: 'Order not found' }); return; }
  if (!['super_admin', 'store_owner'].includes(req.admin!.role)) {
    res.status(403).json({ success: false, error: 'Not authorised to terminate orders' }); return;
  }
  if (['delivered','cancelled','failed_delivery','terminated'].includes(ord.status)) {
    res.status(400).json({ success: false, error: 'Order is already closed' }); return;
  }
  await transaction(async client => {
    await client.query(
      `UPDATE mart_orders SET status='terminated', termination_reason=$1, terminated_by=$2, terminated_at=NOW(), updated_at=NOW() WHERE id=$3`,
      [finalReason, req.admin!.id, req.params.id]
    );
    await OrderService.reverseCampaignRedemption(req.params.id, 'terminated', client);
  });
  const MSGS: Record<string,string> = {
    rider_unavailable: '😔 Sorry — your order could not be completed due to a delivery issue. You will not be charged. Please reorder.',
    store_closed:      '😔 Sorry — our store had to close unexpectedly. You will not be charged. Please reorder.',
    out_of_stock:      '😔 Sorry — an item became unavailable after dispatch. You will not be charged. Please reorder.',
    technical_issue:   '😔 Sorry — a technical issue prevented delivery. You will not be charged. Please reorder.',
    other:             '😔 Sorry — your order had to be cancelled by our team. You will not be charged. Please reorder.',
  };
  if (ord.customer_id) {
    PushService.notifyCustomer(ord.customer_id, { title: `Order #${ord.order_number}`, body: MSGS[reason] || MSGS.other, url: '/orders', tag: `order-${req.params.id}` }).catch(() => {});
  }
  res.json({ success: true, message: 'Order terminated', orderNumber: ord.order_number });
});
// ── Admin customer controllers ────────────────────────────────────────────────

export const adminGetCustomers = asyncHandler(async (req: AdminRequest, res: Response) => {
  const allowedRoles = ['super_admin', 'store_owner', 'store_manager'];
  if (!req.admin || !allowedRoles.includes(req.admin.role)) {
    res.status(403).json({ success: false, error: 'Access denied' }); return;
  }
  const result = await query(
    `SELECT id, phone, name, address, order_count as "orderCount",
            total_spent::float as "totalSpent", created_at as "createdAt"
     FROM mart_customers
     ORDER BY order_count DESC, created_at DESC
     LIMIT 200`
  );
  res.json({ success: true, data: result.rows });
});

export const adminGetCustomerLeads = asyncHandler(async (req: AdminRequest, res: Response) => {
  const status = req.query.status === 'unverified' || req.query.status === 'verified' || req.query.status === 'guest'
    ? req.query.status
    : 'all';
  const range = req.query.range === 'today' || req.query.range === '7d' || req.query.range === '30d' || req.query.range === 'custom'
    ? req.query.range
    : '30d';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (range === 'custom' && !isValidReportDateRange(from, to)) {
    res.status(400).json({ success: false, error: 'Choose a valid custom date range' }); return;
  }
  const [leads, counts] = await Promise.all([
    CustomerLeadService.findAll(status as LeadStatus, range, from, to),
    CustomerLeadService.getCounts(range, from, to),
  ]);
  res.json({ success: true, data: leads, counts, range, from, to, timezone: 'Asia/Kolkata' });
});

export const adminGetCustomerFunnelExtended = asyncHandler(async (req: AdminRequest, res: Response) => {
  const range = req.query.range === 'today' || req.query.range === '7d' || req.query.range === '30d' || req.query.range === 'custom'
    ? req.query.range
    : 'all';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (range === 'custom' && !isValidReportDateRange(from, to)) {
    res.status(400).json({ success: false, error: 'Choose a valid custom date range' }); return;
  }
  const summary = await FunnelService.getExtended(range as FunnelRange, from, to);
  res.json({ success: true, data: summary });
});

export const adminGetCustomerFunnel = asyncHandler(async (req: AdminRequest, res: Response) => {
  const range = req.query.range === 'today' || req.query.range === '7d' || req.query.range === '30d' || req.query.range === 'custom'
    ? req.query.range
    : 'all';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (range === 'custom' && !isValidReportDateRange(from, to)) {
    res.status(400).json({ success: false, error: 'Choose a valid custom date range' }); return;
  }
  const summary = await FunnelService.getSummary(range as FunnelRange, from, to);
  res.json({ success: true, data: summary });
});

function isValidReportDateRange(from: string | undefined, to: string | undefined): boolean {
  const isValidDate = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  };
  return isValidDate(from) && isValidDate(to) && from! <= to!;
}

function csvCell(value: string | null | undefined): string {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

export const adminExportMarketingLeads = asyncHandler(async (req: AdminRequest, res: Response) => {
  const leads = await CustomerLeadService.getMarketingExport();
  const csv = [
    'Name,Mobile Number,Last Successful Login',
    ...leads.map(lead => [
      csvCell(lead.name),
      csvCell(lead.phone),
      csvCell(lead.last_successful_login_at.toISOString()),
    ].join(',')),
  ].join('\n');
  ComplianceService.logAudit({
    adminId: req.admin!.id,
    username: req.admin!.username,
    role: req.admin!.role,
    action: 'export_marketing_leads',
    detail: `Exported ${leads.length} verified marketing-consented customer lead(s)`,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gokez-marketing-leads.csv"');
  res.send(`\uFEFF${csv}`);
});

// ── Admin settings controllers ────────────────────────────────────────────────

export const adminGetSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const settings = await SettingsService.getAll(storeId);
  res.json({ success: true, data: settings });
});

export const adminUpdateSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  await SettingsService.updateMany(storeId, req.body);
  res.json({ success: true, message: 'Settings updated' });
});

// ── Admin zone controllers ────────────────────────────────────────────────────

export const adminGetZones = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const zones = await ZoneService.findAll(false, storeId);
  res.json({ success: true, data: zones });
});

export const adminCreateZone = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const zone = await ZoneService.create({ ...req.body, storeId });
  res.status(201).json({ success: true, data: zone });
});

export const adminUpdateZone = asyncHandler(async (req: AdminRequest, res: Response) => {
  const zone = await ZoneService.update(req.params.id, req.body);
  if (!zone) { res.status(404).json({ success: false, error: 'Zone not found' }); return; }
  res.json({ success: true, data: zone });
});

export const adminDeleteZone = asyncHandler(async (req: AdminRequest, res: Response) => {
  await ZoneService.delete(req.params.id);
  res.json({ success: true, message: 'Zone deleted' });
});

// ── Admin store controllers (super_admin only) ────────────────────────────────

export const adminGetStores = asyncHandler(async (req: AdminRequest, res: Response) => {
  const stores = await StoreService.findAll();
  // Non-super-admin only sees their own store
  if (req.admin?.role !== 'super_admin' && req.admin?.storeId) {
    res.json({ success: true, data: stores.filter(s => s.id === req.admin!.storeId) });
    return;
  }
  res.json({ success: true, data: stores });
});

export const adminCreateStore = asyncHandler(async (req: AdminRequest, res: Response) => {
  const store = await StoreService.create(req.body);
  // Set estimated_delivery setting for new store
  if (req.body.estimatedDelivery) {
    await SettingsService.update(store.id, 'estimated_delivery', req.body.estimatedDelivery);
  }
  res.status(201).json({ success: true, data: store });
});

export const adminUpdateStore = asyncHandler(async (req: AdminRequest, res: Response) => {
  const store = await StoreService.update(req.params.id, req.body);
  if (!store) { res.status(404).json({ success: false, error: 'Store not found' }); return; }
  if (req.body.estimatedDelivery) {
    await SettingsService.update(req.params.id, 'estimated_delivery', req.body.estimatedDelivery);
  }
  res.json({ success: true, data: store });
});

// Store manager updates their own store settings (hours, logo, support phone)
export const adminUpdateStoreSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = req.admin?.storeId || req.params.id;
  // Store manager can only update their own store
  if (req.admin?.role !== 'super_admin' && req.admin?.storeId !== req.params.id) {
    res.status(403).json({ success: false, error: 'Not authorised' }); return;
  }
  const { logoUrl, supportPhone, openingHours, ownerName } = req.body;
  const store = await StoreService.update(storeId, { logoUrl, supportPhone, openingHours, ownerName });
  if (!store) { res.status(404).json({ success: false, error: 'Store not found' }); return; }
  res.json({ success: true, data: store });
});

// Public: submit store application
export const submitStoreApplication = asyncHandler(async (req: Request, res: Response) => {
  const { storeName, ownerName, phone, area, message } = req.body;
  if (!storeName?.trim() || !ownerName?.trim() || !phone?.trim() || !area?.trim()) {
    res.status(400).json({ success: false, error: 'storeName, ownerName, phone and area are required' }); return;
  }
  const app = await StoreService.createApplication({ storeName, ownerName, phone, area, message });
  res.status(201).json({ success: true, data: app, message: 'Application submitted. We will review and contact you within 2-3 business days.' });
});

// Super admin: get all store applications
export const adminGetStoreApplications = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const apps = await StoreService.findAllApplications();
  res.json({ success: true, data: apps });
});

// Super admin: approve/reject store application
export const adminUpdateStoreApplication = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400).json({ success: false, error: 'status must be approved or rejected' }); return;
  }
  await StoreService.updateApplication(req.params.id, status, req.admin!.id);
  res.json({ success: true, message: `Application ${status}` });
});

// ── Customer auth controllers ─────────────────────────────────────────────────

export const customerSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) { res.status(400).json({ success: false, error: 'Phone number required' }); return; }
  const result = await CustomerAuthService.sendOtp(phone);
  res.json({ success: true, message: result.message });
});

export const customerVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, otp, funnelSessionId } = req.body;
  if (!phone || !otp) { res.status(400).json({ success: false, error: 'Phone and OTP required' }); return; }
  const result = await CustomerAuthService.verifyOtp(phone, otp);
  // Attribution link only. Auth behaviour is unchanged and a missing or invalid
  // session id is ignored rather than surfaced, so a tracking failure can never
  // affect whether a customer logs in. The phone is not stored here; the
  // customer id was already resolved server-side by the call above.
  if (funnelSessionId && result?.customer?.id) {
    await FunnelEventService.linkSessionToCustomer(funnelSessionId, result.customer.id).catch(() => undefined);
  }
  res.json({ success: true, data: result });
});

export const postFunnelEvent = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, eventName, path, props, channel, referrer, utmSource, utmMedium, utmCampaign } = req.body ?? {};
  if (!sessionId || !eventName) {
    res.status(400).json({ success: false, error: 'sessionId and eventName required' });
    return;
  }
  const recorded = await FunnelEventService.recordEvent({
    sessionId, eventName, path, props, channel, referrer, utmSource, utmMedium, utmCampaign,
  });
  res.json({ success: true, data: { recorded } });
});

export const postFunnelCart = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { sessionId, items, reachedCheckout } = req.body ?? {};
  if (!sessionId) { res.status(400).json({ success: false, error: 'sessionId required' }); return; }

  // The customer is resolved here, never read from the request body. This
  // endpoint is public, so a body-supplied customerId let anyone attach a cart
  // to any account in the database -- and through the one-live-cart-per-customer
  // index, occupy that account's live cart slot.
  //
  // Two server-side sources, in order of strength: an authenticated customer,
  // then the verified-customer link on this session. The session link is only
  // ever written after OTP verification, so a caller cannot forge it by sending
  // a customerId.
  const customerId = req.customer?.id
    ?? await FunnelEventService.resolveSessionCustomer(String(sessionId)).catch(() => null);

  const result = await FunnelCartService.upsert({
    sessionId,
    customerId: customerId ?? null,
    items: Array.isArray(items) ? items : [],
    reachedCheckout: reachedCheckout === true,
  });
  res.json({ success: true, data: result });
});

export const postFunnelCampaignTouch = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, campaignId } = req.body ?? {};
  if (!sessionId || !campaignId) {
    res.status(400).json({ success: false, error: 'sessionId and campaignId required' });
    return;
  }
  await FunnelEventService.recordCampaignTouch(sessionId, campaignId);
  res.json({ success: true });
});

export const customerGetMe = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const customer = await CustomerAuthService.getCustomer(req.customer!.id);
  if (!customer) { res.status(404).json({ success: false, error: 'Customer not found' }); return; }
  res.json({ success: true, data: customer });
});

export const customerUpdateProfile = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const customer = await CustomerAuthService.updateProfile(req.customer!.id, req.body);
  res.json({ success: true, data: customer });
});

// ── Customer address book ─────────────────────────────────────────────────────

export const customerGetAddresses = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const addresses = await CustomerAuthService.getAddresses(req.customer!.id);
  res.json({ success: true, data: addresses });
});

export const customerAddAddress = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { label, addressLine, isDefault, latitude, longitude } = req.body;
  if (!addressLine || !addressLine.trim()) { res.status(400).json({ success: false, error: 'Address is required' }); return; }
  if (!hasValidCoordinates(latitude, longitude)) { res.status(400).json({ success: false, error: 'Invalid address coordinates' }); return; }
  const address = await CustomerAuthService.addAddress(req.customer!.id, label ?? 'Home', addressLine, !!isDefault, latitude, longitude);
  res.json({ success: true, data: address });
});

export const customerUpdateAddress = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { label, addressLine, latitude, longitude } = req.body;
  if (!addressLine || !addressLine.trim()) { res.status(400).json({ success: false, error: 'Address is required' }); return; }
  if (!hasValidCoordinates(latitude, longitude)) { res.status(400).json({ success: false, error: 'Invalid address coordinates' }); return; }
  const address = await CustomerAuthService.updateAddress(req.customer!.id, req.params.id, label ?? 'Home', addressLine, latitude, longitude);
  res.json({ success: true, data: address });
});

export const customerDeleteAddress = asyncHandler(async (req: CustomerRequest, res: Response) => {
  await CustomerAuthService.deleteAddress(req.customer!.id, req.params.id);
  res.json({ success: true });
});

export const customerSetDefaultAddress = asyncHandler(async (req: CustomerRequest, res: Response) => {
  await CustomerAuthService.setDefaultAddress(req.customer!.id, req.params.id);
  res.json({ success: true });
});

export const customerGetOrders = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const orders = await OrderService.findAll({ phone: req.customer!.phone, limit: 20 });
  res.json({ success: true, data: orders });
});

/**
 * Shared cancellation handler. `scope` decides what the caller must present:
 * a session customer id, or a guest tracking token. The service does the
 * matching, so the two entry points cannot drift on status rules or on the
 * side effects of cancelling (campaign redemption, audit event, store push).
 */
type CancelScope = { customerId: string } | { trackingToken: string };

/**
 * Shared cancellation handler. `scope` decides what the caller must present:
 * a session customer id, or a guest tracking token. The service owns the
 * matching, so the two entry points cannot drift on the status rules or on the
 * side effects of cancelling (campaign redemption, audit event, store push).
 */
async function runCancel(req: CustomerRequest, res: Response, scope: CancelScope) {
  let order;
  try {
    order = await OrderService.cancelByCaller(req.params.id, scope);
  } catch (err: any) {
    const status = err?.status === 404 || err?.status === 400 ? err.status : 500;
    res.status(status).json({ success: false, error: err?.message || 'Could not cancel the order' });
    return;
  }

  if (order.storeId) {
    PushService.notifyStoreAdmins(order.storeId, {
      title: `Order #${order.orderNumber} cancelled`,
      body: `${order.guestName || 'Customer'} cancelled the order`,
      url: '/orders',
      tag: `order-${req.params.id}`,
    }).catch(() => {});
  }
  res.json({ success: true, message: 'Order cancelled' });
}

export const customerCancelOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  if (!req.customer) { res.status(401).json({ success: false, error: 'Not signed in' }); return; }
  await runCancel(req, res, { customerId: req.customer.id });
});

/**
 * Guest self-service cancel. The tracking token is the credential the guest
 * already holds from placing the order, so no OTP is needed. Without a valid
 * token this returns the same 404 as an unknown order id, so order ids cannot
 * be probed. Rate limited separately from order placement in app.ts.
 */
export const guestCancelOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const token = typeof req.body?.trackingToken === 'string' ? req.body.trackingToken.trim() : '';
  if (!token) {
    res.status(400).json({ success: false, error: 'A tracking token is required' });
    return;
  }
  await runCancel(req, res, { trackingToken: token });
});

// ── Admin user management (super_admin only) ─────────────────────────────────

export const adminGetUsers = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const result = await query(
    `SELECT id, username, name, email, phone, role,
            store_id as "storeId",
            is_active as "isActive",
            last_login_at as "lastLoginAt",
            created_at as "createdAt"
     FROM mart_admins
     ORDER BY role ASC, name ASC`
  );
  res.json({ success: true, data: result.rows });
});

export const adminCreateUser = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { username, password, name, email, phone, role, storeId } = req.body;
  if (!username?.trim() || !password || !role) {
    res.status(400).json({ success: false, error: 'username, password and role are required' }); return;
  }
  if (password.length < 8) {
    res.status(400).json({ success: false, error: 'Password must be at least 8 characters' }); return;
  }
  if (!isValidAdminRole(role)) {
    res.status(400).json({ success: false, error: `Role must be one of: ${ADMIN_ROLE_LIST}` }); return;
  }
  if (role !== 'super_admin' && !storeId) {
    res.status(400).json({ success: false, error: 'storeId is required for non-super_admin roles' }); return;
  }
  const existing = await query(`SELECT 1 FROM mart_admins WHERE username = $1`, [username.trim()]);
  if (existing.rows.length) {
    res.status(409).json({ success: false, error: 'Username already exists' }); return;
  }
  const hash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO mart_admins (id, username, password_hash, name, email, phone, role, store_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING id, username, name, email, phone, role, store_id as "storeId", created_at as "createdAt"`,
    [username.trim(), hash, name?.trim() || null, email?.trim() || null,
     phone?.trim() || null, role, role === 'super_admin' ? null : storeId]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const adminUpdateUser = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, email, phone, role, storeId, password, isActive } = req.body;
  const { id } = req.params;
  if (id === req.admin!.id && role && role !== req.admin!.role) {
    res.status(400).json({ success: false, error: 'Cannot change your own role' }); return;
  }
  if (id === req.admin!.id && isActive === false) {
    res.status(400).json({ success: false, error: 'Cannot deactivate your own account' }); return;
  }
  // Previously unvalidated: `role` was pushed straight into the UPDATE and the
  // only backstop was the database CHECK, so a bad role surfaced as a 500.
  if (role !== undefined && !isValidAdminRole(role)) {
    res.status(400).json({ success: false, error: `Role must be one of: ${ADMIN_ROLE_LIST}` }); return;
  }
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (name !== undefined)     { fields.push(`name = $${i++}`);      params.push(name?.trim() || null); }
  if (email !== undefined)    { fields.push(`email = $${i++}`);     params.push(email?.trim() || null); }
  if (phone !== undefined)    { fields.push(`phone = $${i++}`);     params.push(phone?.trim() || null); }
  if (role !== undefined)     { fields.push(`role = $${i++}`);      params.push(role); }
  if (storeId !== undefined)  { fields.push(`store_id = $${i++}`);  params.push(role === 'super_admin' ? null : storeId); }
  if (isActive !== undefined) { fields.push(`is_active = $${i++}`); params.push(isActive); }
  if (password) {
    if (password.length < 8) { res.status(400).json({ success: false, error: 'Password must be at least 8 characters' }); return; }
    const hash = await bcrypt.hash(password, 12);
    fields.push(`password_hash = $${i++}`); params.push(hash);
  }
  if (!fields.length) { res.status(400).json({ success: false, error: 'Nothing to update' }); return; }
  fields.push(`updated_at = NOW()`);
  params.push(id);
  const result = await query(
    `UPDATE mart_admins SET ${fields.join(', ')} WHERE id = $${i}
     RETURNING id, username, name, email, phone, role, store_id as "storeId", is_active as "isActive"`,
    params
  );
  if (!result.rows[0]) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, data: result.rows[0] });
});

export const adminDeleteUser = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (req.params.id === req.admin!.id) {
    res.status(400).json({ success: false, error: 'Cannot delete your own account' }); return;
  }
  await query(`DELETE FROM mart_admins WHERE id = $1`, [req.params.id]);
  res.json({ success: true, message: 'User deleted' });
});

// ── Push subscription endpoints ────────────────────────────────────────────────────────────

export const customerSavePushSub = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ success: false, error: 'Invalid subscription' }); return;
  }
  await PushService.saveCustomerSubscription(req.customer!.id, { endpoint, keys });
  res.json({ success: true });
});

export const adminSavePushSub = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ success: false, error: 'Invalid subscription' }); return;
  }
  await PushService.saveAdminSubscription(req.admin!.id, { endpoint, keys });
  res.json({ success: true });
});

export const getVapidPublicKey = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { publicKey: config.vapid.publicKey } });
});

// ── DPDP Compliance controllers ────────────────────────────────────────────────────────────

// Customer: request account deletion
export const customerRequestDeletion = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { reason } = req.body;
  const result = await ComplianceService.requestDeletion(req.customer!.id, reason);
  res.status(201).json({ success: true, data: result, message: 'Deletion request submitted. We will process within 30 days.' });
});

export const customerGetDeletionStatus = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const result = await ComplianceService.getDeletionRequest(req.customer!.id);
  res.json({ success: true, data: result });
});

// Customer: submit grievance
export const customerSubmitGrievance = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { subject, description } = req.body;
  if (!subject?.trim() || !description?.trim()) {
    res.status(400).json({ success: false, error: 'Subject and description are required' }); return;
  }
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }
  const result = await ComplianceService.submitGrievance(req.customer!.id, subject.trim(), description.trim(), idempotencyKey);
  res.status(201).json({ success: true, data: result, message: 'Grievance submitted. We will respond within 30 days.' });
});

export const customerGetGrievances = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const result = await ComplianceService.getMyGrievances(req.customer!.id);
  res.json({ success: true, data: result });
});

// Admin: deletion requests
export const adminGetDeletionRequests = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const result = await ComplianceService.getAllDeletionRequests();
  res.json({ success: true, data: result });
});

export const adminProcessDeletion = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { action, notes } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    res.status(400).json({ success: false, error: 'action must be approved or rejected' }); return;
  }
  await ComplianceService.processDeletion(req.params.id, req.admin!.id, action, notes);
  res.json({ success: true, message: `Deletion request ${action}` });
});

// Admin: grievances
export const adminGetGrievances = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const result = await ComplianceService.getAllGrievances();
  res.json({ success: true, data: result });
});

export const adminRespondGrievance = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { response, status } = req.body;
  if (!response?.trim() || !status) {
    res.status(400).json({ success: false, error: 'response and status are required' }); return;
  }
  await ComplianceService.respondToGrievance(req.params.id, req.admin!.id, response.trim(), status);
  res.json({ success: true, message: 'Grievance updated' });
});

// Customer: logout (blacklist token)
export const customerLogout = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.decode(auth.slice(7)) as any;
      if (payload?.jti && payload?.exp) {
        await ComplianceService.blacklistToken(payload.jti, new Date(payload.exp * 1000));
      }
    } catch {}
  }
  res.json({ success: true, message: 'Logged out' });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

export const adminGetAuditLogs = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { adminId, action, limit } = req.query;
  const logs = await ComplianceService.getAuditLogs({
    adminId: adminId as string,
    action: action as string,
    limit: limit ? parseInt(limit as string) : 200,
  });
  res.json({ success: true, data: logs });
});

// ── Data export (Right to Portability) ───────────────────────────────────────

export const customerRequestDataExport = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const result = await ComplianceService.requestDataExport(req.customer!.id);
  res.json({ success: true, data: result, message: 'Your data export is ready.' });
});

export const customerGetDataExport = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const result = await ComplianceService.getDataExport(req.customer!.id);
  if (!result) { res.status(404).json({ success: false, error: 'No export found' }); return; }
  res.json({ success: true, data: result });
});

// ── Marketing consent ─────────────────────────────────────────────────────────

export const customerUpdateMarketingConsent = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { granted } = req.body;
  if (typeof granted !== 'boolean') { res.status(400).json({ success: false, error: 'granted must be boolean' }); return; }
  await ComplianceService.updateMarketingConsent(req.customer!.id, granted);
  res.json({ success: true, message: `Marketing consent ${granted ? 'granted' : 'withdrawn'}` });
});

export const customerGetMarketingConsent = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const granted = await ComplianceService.getMarketingConsent(req.customer!.id);
  res.json({ success: true, data: { granted } });
});

export const customerUploadPhoto = asyncHandler(async (req: CustomerRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ success: false, error: 'No file uploaded' }); return; }
  const bucket = config.supabase.bucket;
  const image = await prepareImage(req.file.buffer, 512);
  const filename = `customers/${req.customer!.id}-${Date.now()}.${image.extension}`;
  const uploadUrl = `${config.supabase.url}/storage/v1/object/${bucket}/${filename}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.supabase.serviceRoleKey}`,
      'Content-Type': image.mimeType,
      'x-upsert': 'true',
      'cache-control': 'max-age=31536000',
    },
    body: image.buffer,
  });
  if (!uploadRes.ok) { res.status(500).json({ success: false, error: 'Upload failed' }); return; }
  const publicUrl = `${config.supabase.url}/storage/v1/object/public/${bucket}/${filename}`;
  await CustomerAuthService.updateProfile(req.customer!.id, { photoUrl: publicUrl });
  res.json({ success: true, data: { url: publicUrl } });
});

// ── Feedback ────────────────────────────────────────────────────────────────────────────────

export const customerSubmitFeedback = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { rating, category, message, storeId, orderId } = req.body;
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ success: false, error: 'Rating 1-5 required' }); return; }
  if (!category) { res.status(400).json({ success: false, error: 'Category required' }); return; }
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }

  // Fetch customer details
  const custRes = await query<{ name: string | null; phone: string }>(
    `SELECT name, phone FROM mart_customers WHERE id = $1`, [req.customer!.id]
  );
  const customer = custRes.rows[0];

  // Fetch store name if storeId provided
  let storeName = null;
  if (storeId) {
    const storeRes = await query<{ name: string }>(`SELECT name FROM mart_stores WHERE id = $1`, [storeId]);
    storeName = storeRes.rows[0]?.name || null;
  }

  const result = await query(
    `INSERT INTO mart_feedback (customer_id, store_id, order_id, rating, category, message, customer_name, customer_phone, store_name, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT DO NOTHING
     RETURNING id, rating, category, created_at as "createdAt"`,
    [req.customer!.id, storeId || null, orderId || null, rating, category,
     message?.trim() || null, customer?.name || null, customer?.phone || null, storeName, idempotencyKey]
  );
  const feedback = result.rows[0] || (await query(
    `SELECT id, rating, category, created_at as "createdAt" FROM mart_feedback WHERE idempotency_key = $1`, [idempotencyKey]
  )).rows[0];
  res.status(201).json({ success: true, data: feedback, message: 'Thank you for your feedback!' });
});

export const adminGetFeedback = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { rating, category, limit, offset } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  // Super admin sees all, store roles see only their store
  if (req.admin?.role !== 'super_admin') {
    conditions.push(`store_id = $${i++}`); params.push(storeId);
  } else if (req.query.storeId) {
    conditions.push(`store_id = $${i++}`); params.push(req.query.storeId);
  }
  if (rating)   { conditions.push(`rating = $${i++}`);   params.push(parseInt(rating as string)); }
  if (category) { conditions.push(`category = $${i++}`); params.push(category); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(parseInt(limit as string) || 50);
  params.push(parseInt(offset as string) || 0);

  const result = await query(
    `SELECT id, rating, category, message, customer_name as "customerName",
            customer_phone as "customerPhone", store_name as "storeName",
            created_at as "createdAt"
     FROM mart_feedback ${where}
     ORDER BY created_at DESC
     LIMIT $${i} OFFSET $${i+1}`,
    params
  );

  // Summary stats
  const statsRes = await query(
    `SELECT
       COUNT(*)::int as total,
       ROUND(AVG(rating)::numeric, 1)::float as avg_rating,
       COUNT(*) FILTER (WHERE rating = 5)::int as five_star,
       COUNT(*) FILTER (WHERE rating = 4)::int as four_star,
       COUNT(*) FILTER (WHERE rating <= 3)::int as low_star
     FROM mart_feedback ${where}`,
    params.slice(0, -2)
  );

  res.json({ success: true, data: result.rows, stats: statsRes.rows[0] });
});

// ── Admin photo upload ────────────────────────────────────────────────────────

export const adminUploadPhoto = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ success: false, error: 'No file uploaded' }); return; }

  const bucket = config.supabase.bucket;
  const image = await prepareImage(req.file.buffer, 1600);
  const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
  const filename = `${Date.now()}-${baseName || 'image'}.${image.extension}`;
  const uploadUrl = `${config.supabase.url}/storage/v1/object/${bucket}/${filename}`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.supabase.serviceRoleKey}`,
      'Content-Type': image.mimeType,
      'x-upsert': 'false',
      'cache-control': 'max-age=31536000',
    },
    body: image.buffer,
  });

  if (!uploadRes.ok) {
    await uploadRes.text(); // consume body
    res.status(500).json({ success: false, error: 'Upload failed. Please try again.' });
    return;
  }

  const publicUrl = `${config.supabase.url}/storage/v1/object/public/${bucket}/${filename}`;
  res.json({ success: true, data: { url: publicUrl } });
});

// ── Team management ───────────────────────────────────────────────────────────

export const getStoreTeam = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = req.params.storeId || resolveStoreId(req);
  const team = await TeamService.getStoreTeam(storeId);
  res.json({ success: true, data: team });
});

export const addToStoreTeam = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = req.params.storeId || resolveStoreId(req);
  const { adminId, role, username, password, name, phone, email } = req.body;
  if (!role) { res.status(400).json({ success: false, error: 'role is required' }); return; }
  // Checked here, at the edge, so an unusable role is a readable 400. Validating
  // only inside the service meant the error surfaced as a bare 500, because
  // errorHandler masks the message for any 5xx.
  if (!isValidAdminRole(role)) {
    res.status(400).json({ success: false, error: `Role must be one of: ${ADMIN_ROLE_LIST}` }); return;
  }
  if (adminId) {
    await TeamService.addToStore(adminId, storeId, role, req.admin!.id);
    res.json({ success: true, message: 'Member added to store' });
  } else {
    if (!username || !password) { res.status(400).json({ success: false, error: 'username and password required' }); return; }
    if (password.length < 8) {
      res.status(400).json({ success: false, error: 'Password must be at least 8 characters' }); return;
    }
    const member = await TeamService.createAndAssign({ username, password, name, phone, email, role, storeId, assignedBy: req.admin!.id });
    res.status(201).json({ success: true, data: member });
  }
});

export const updateStoreTeamMember = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { storeId, userId } = req.params;
  await TeamService.updateAssignment(userId, storeId, req.body);
  res.json({ success: true, message: 'Member updated' });
});

export const removeFromStoreTeam = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { storeId, userId } = req.params;
  await TeamService.removeFromStore(userId, storeId);
  res.json({ success: true, message: 'Member removed from store' });
});

export const lookupUserByPhone = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { phone } = req.query;
  if (!phone) { res.status(400).json({ success: false, error: 'phone is required' }); return; }
  const user = await TeamService.lookupByPhone(phone as string);
  if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  const stores = await TeamService.getUserStores(user.id);
  res.json({ success: true, data: { ...user, stores } });
});

export const getUserStores = asyncHandler(async (req: AdminRequest, res: Response) => {
  const stores = await TeamService.getUserStores(req.params.userId);
  res.json({ success: true, data: stores });
});

export const deactivateStore = asyncHandler(async (req: AdminRequest, res: Response) => {
  await StoreService.update(req.params.id, { isActive: false, isLive: false });
  await TeamService.deactivateStoreAssignments(req.params.id);
  res.json({ success: true, message: 'Store deactivated and all assignments removed' });
});

// ── Inventory controllers ─────────────────────────────────────────────────────

export const adminGetInventory = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const data = await InventoryService.getStoreInventory(storeId);
  res.json({ success: true, data });
});

export const adminRestockProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }
  const storeId = resolveStoreId(req);
  const { qty, stockUnit, note } = req.body;
  if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) {
    res.status(400).json({ success: false, error: 'qty must be a positive number' }); return;
  }
  if (!stockUnit) {
    res.status(400).json({ success: false, error: 'stockUnit is required' }); return;
  }
  const result = await InventoryService.restock(
    req.params.productId, storeId, parseFloat(qty), stockUnit, note || null, req.admin!.id, idempotencyKey
  );
  res.json({ success: true, data: result });
});

export const adminGetInventoryHistory = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const data = await InventoryService.getHistory(req.params.productId, storeId);
  res.json({ success: true, data });
});

export const adminSetProductStock = asyncHandler(async (req: AdminRequest, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }
  const storeId = resolveStoreId(req);
  const { qty, stockUnit } = req.body;
  if (qty === undefined || isNaN(parseFloat(qty)) || parseFloat(qty) < 0) {
    res.status(400).json({ success: false, error: 'qty must be a non-negative number' }); return;
  }
  if (!stockUnit) {
    res.status(400).json({ success: false, error: 'stockUnit is required' }); return;
  }
  const result = await InventoryService.setStock(
    req.params.productId, storeId, parseFloat(qty), stockUnit, req.admin!.id, idempotencyKey
  );
  res.json({ success: true, data: result });
});

export const adminBulkRestock = asyncHandler(async (req: AdminRequest, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }
  const storeId = resolveStoreId(req);
  const { items, note } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ success: false, error: 'items array required' }); return;
  }
  const results = await InventoryService.bulkRestock(storeId, items, note || null, req.admin!.id, idempotencyKey);
  res.json({ success: true, data: results, message: `${results.length} product(s) restocked` });
});

// ── Campaign controllers ──────────────────────────────────────────────────────

export const adminGetCampaigns = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (!req.admin || !['super_admin', 'store_owner', 'store_manager'].includes(req.admin.role)) {
    res.status(403).json({ success: false, error: 'Access denied' }); return;
  }
  const isSuperAdmin = req.admin?.role === 'super_admin';
  const storeId = resolveStoreId(req);
  const campaigns = await CampaignService.findAll(storeId, isSuperAdmin);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json({ success: true, data: campaigns });
});

export const adminCreateCampaign = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (req.admin?.role !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Only Super Admin can manage campaigns' }); return;
  }
  const campaign = await CampaignService.create(req.body, req.admin.id);
  res.status(201).json({ success: true, data: campaign });
});

export const adminUpdateCampaign = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (req.admin?.role !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Only Super Admin can manage campaigns' }); return;
  }
  try {
    const campaign = await CampaignService.update(req.params.id, { ...req.body, adminId: req.admin?.id || null });
    if (!campaign) { res.status(404).json({ success: false, error: 'Campaign not found' }); return; }
    res.json({ success: true, data: campaign });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Campaign could not be updated' });
  }
});

export const adminGetCampaignRedemptions = asyncHandler(async (req: AdminRequest, res: Response) => {
  try {
    const data = await CampaignService.getRedemptions(req.params.id);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export const adminSupersedeCampaign = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (req.admin?.role !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Only Super Admin can manage campaigns' }); return;
  }
  try {
    const campaign = await CampaignService.supersede(req.params.id, req.body, req.admin.id);
    res.json({ success: true, data: campaign });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export const adminDeleteCampaign = asyncHandler(async (req: AdminRequest, res: Response) => {
  try {
    await CampaignService.delete(req.params.id);
    res.json({ success: true, message: 'Campaign deleted' });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Carousel controllers ──────────────────────────────────────────────────────

export const getCarouselSlides = asyncHandler(async (_req: Request, res: Response) => {
  const slides = await CampaignService.getCarouselSlides(true);
  res.json({ success: true, data: slides });
});

export const adminGetCarouselSlides = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const slides = await CampaignService.getCarouselSlides(false);
  res.json({ success: true, data: slides });
});

export const adminCreateCarouselSlide = asyncHandler(async (req: AdminRequest, res: Response) => {
  const slide = await CampaignService.createSlide(req.body, req.admin!.id);
  res.status(201).json({ success: true, data: slide });
});

export const adminUpdateCarouselSlide = asyncHandler(async (req: AdminRequest, res: Response) => {
  const slide = await CampaignService.updateSlide(req.params.id, req.body);
  res.json({ success: true, data: slide });
});

export const adminDeleteCarouselSlide = asyncHandler(async (req: AdminRequest, res: Response) => {
  await CampaignService.deleteSlide(req.params.id);
  res.json({ success: true, message: 'Slide deleted' });
});

export const adminReorderCarouselSlides = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) { res.status(400).json({ success: false, error: 'ids array required' }); return; }
  await CampaignService.reorderSlides(ids);
  res.json({ success: true, message: 'Reordered' });
});

// ── Public campaign routes ────────────────────────────────────────────────────

export const getEligibleCampaigns = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { cartTotal, storeId } = req.query;
  const campaigns = await CampaignService.getEligible(
    req.customer?.id || null,
    parseFloat(cartTotal as string) || 0,
    (storeId as string) || ''
  );
  res.json({ success: true, data: campaigns });
});

// Public by design: this is the pre-login welcome teaser. It returns a
// whitelisted projection (see CampaignService.getPublicWelcomeOffers) and grants
// no authority — an offer can only actually be redeemed after OTP.
export const getPublicWelcomeOffers = asyncHandler(async (req: Request, res: Response) => {
  const { cartTotal, storeId } = req.query;
  const offers = await CampaignService.getPublicWelcomeOffers(
    parseFloat(cartTotal as string) || 0,
    (storeId as string) || ''
  );
  res.json({ success: true, data: offers });
});

export const validateCouponCode = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { code, cartTotal, storeId } = req.body;
  if (!code) { res.status(400).json({ success: false, error: 'Coupon code required' }); return; }
  try {
    const campaign = await CampaignService.validateCode(
      code, req.customer!.id,
      parseFloat(cartTotal) || 0,
      storeId || ''
    );
    const discount = CampaignService.calculateDiscount(campaign, parseFloat(cartTotal) || 0);
    res.json({ success: true, data: { campaign, discount } });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});
