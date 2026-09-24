import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { asyncHandler, AdminRequest } from '../middleware';
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
import { config } from '../config';

const SHAPOORJI_ID = '00000000-0000-0000-0000-000000000001';

type PreparedImage = { buffer: Buffer; extension: string; mimeType: string };

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
  res.json({ success: true, data: settings });
});

export const placeOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { guestName, guestPhone, guestAddress, items, paymentMethod, notes, storeId, zoneName, deliveryPreference, deliveryNote, campaignId, couponCode } = req.body;
  if (!guestName || !guestPhone || !guestAddress || !items?.length || !paymentMethod) {
    res.status(400).json({ success: false, error: 'Missing required fields' });
    return;
  }
  const cleanPhone = String(guestPhone).replace(/\D/g, '');
  if (cleanPhone.length !== 10) { res.status(400).json({ success: false, error: 'Invalid phone number' }); return; }
  if (!['cod', 'upi', 'phonepay'].includes(paymentMethod)) { res.status(400).json({ success: false, error: 'Invalid payment method' }); return; }
  if (!Array.isArray(items) || !items.every((i: any) => i.productId && i.unit && Number.isInteger(i.quantity) && i.quantity > 0)) {
    res.status(400).json({ success: false, error: 'Invalid items' }); return;
  }
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length > 128) {
    res.status(400).json({ success: false, error: 'A valid Idempotency-Key is required' }); return;
  }
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
    guestName, guestPhone, guestAddress, items, paymentMethod, notes,
    storeId: storeId || SHAPOORJI_ID,
    storeName,
    zoneName, deliveryPreference, deliveryNote,
    campaignId: campaignId || null,
    couponCodeUsed: couponCode || null,
    customerId: req.customer?.id || null,
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
  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role, storeId: admin.store_id, jti: require('uuid').v4() },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as any
  );
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
  const order = await OrderService.transitionStatus(req.params.id, status, req.admin!, deliveryAssigneeId);
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
    cancelled: 'Your order has been cancelled. You will not be charged.',
    failed_delivery: 'We could not complete delivery. Please contact support if you need help.',
  };
  const tag = `order-${order.id}`;
  if (status === 'ready_to_pickup' && detail?.delivery_by) {
    PushService.notifyAdmin(detail.delivery_by, {
      title: `Order #${order.orderNumber} ready for pickup`,
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
      title: `Delivery failed · Order #${order.orderNumber}`,
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
  const finalReason = reason === 'other' ? (customReason?.trim() || 'Other') : reason;
  if (!['super_admin', 'store_owner'].includes(req.admin!.role)) {
    res.status(403).json({ success: false, error: 'Not authorised to terminate orders' }); return;
  }
  const existing = await query<{ status: string; customer_id: string | null; store_id: string | null; order_number: string; guest_name: string }>(
    `SELECT status, customer_id, store_id, order_number, guest_name FROM mart_orders WHERE id = $1`, [req.params.id]
  );
  const ord = existing.rows[0];
  if (!ord) { res.status(404).json({ success: false, error: 'Order not found' }); return; }
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
    outside_area:      '😔 Sorry — your delivery address is currently outside our delivery zone. You will not be charged. We are expanding soon and will be in your area! 🌱',
    other:             '😔 Sorry — your order had to be cancelled by our team. You will not be charged. Please reorder.',
  };
  if (ord.customer_id) {
    PushService.notifyCustomer(ord.customer_id, { title: `Order #${ord.order_number}`, body: MSGS[reason] || MSGS.other, url: '/orders', tag: `order-${req.params.id}` }).catch(() => {});
  }
  res.json({ success: true, message: 'Order terminated', orderNumber: ord.order_number });
});
// ── Admin customer controllers ────────────────────────────────────────────────

export const adminGetCustomers = asyncHandler(async (req: AdminRequest, res: Response) => {
  const allowedRoles = ['super_admin', 'store_owner', 'store_manager', 'sales_manager'];
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
  const { phone, otp } = req.body;
  if (!phone || !otp) { res.status(400).json({ success: false, error: 'Phone and OTP required' }); return; }
  const result = await CustomerAuthService.verifyOtp(phone, otp);
  res.json({ success: true, data: result });
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
  const { label, addressLine, isDefault } = req.body;
  if (!addressLine || !addressLine.trim()) { res.status(400).json({ success: false, error: 'Address is required' }); return; }
  const address = await CustomerAuthService.addAddress(req.customer!.id, label ?? 'Home', addressLine, !!isDefault);
  res.json({ success: true, data: address });
});

export const customerUpdateAddress = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { label, addressLine } = req.body;
  if (!addressLine || !addressLine.trim()) { res.status(400).json({ success: false, error: 'Address is required' }); return; }
  const address = await CustomerAuthService.updateAddress(req.customer!.id, req.params.id, label ?? 'Home', addressLine);
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

export const customerCancelOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { id } = req.params;
  // Verify order belongs to this customer and is cancellable
  const result = await query<{ status: string; customer_id: string | null; store_id: string | null; order_number: string; guest_name: string }>(
    `SELECT status, customer_id, store_id, order_number, guest_name FROM mart_orders WHERE id = $1`, [id]
  );
  const order = result.rows[0];
  if (!order) { res.status(404).json({ success: false, error: 'Order not found' }); return; }
  if (order.customer_id !== req.customer!.id) { res.status(403).json({ success: false, error: 'Not your order' }); return; }
  if (!['pending', 'confirmed'].includes(order.status)) {
    res.status(400).json({ success: false, error: 'Order cannot be cancelled at this stage' }); return;
  }
  await transaction(async client => {
    await client.query(`UPDATE mart_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
    await OrderService.reverseCampaignRedemption(id, 'cancelled', client);
  });
  // Notify store admins
  if (order.store_id) {
    PushService.notifyStoreAdmins(order.store_id, {
      title: `Order #${order.order_number} cancelled`,
      body: `${order.guest_name} cancelled the order`,
      url: '/orders',
      tag: `order-${id}`,
    }).catch(() => {});
  }
  res.json({ success: true, message: 'Order cancelled' });
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
  const valid = ['super_admin', 'store_owner', 'store_manager', 'sales_manager', 'staff', 'delivery_staff'];
  if (!valid.includes(role)) {
    res.status(400).json({ success: false, error: `Role must be one of: ${valid.join(', ')}` }); return;
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
  if (adminId) {
    await TeamService.addToStore(adminId, storeId, role, req.admin!.id);
    res.json({ success: true, message: 'Member added to store' });
  } else {
    if (!username || !password) { res.status(400).json({ success: false, error: 'username and password required' }); return; }
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
  const campaign = await CampaignService.update(req.params.id, req.body);
  if (!campaign) { res.status(404).json({ success: false, error: 'Campaign not found' }); return; }
  res.json({ success: true, data: campaign });
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
    req.customer!.id,
    parseFloat(cartTotal as string) || 0,
    (storeId as string) || ''
  );
  res.json({ success: true, data: campaigns });
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
