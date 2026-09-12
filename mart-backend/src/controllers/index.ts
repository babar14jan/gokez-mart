import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
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
import { query } from '../database/db';
import { InventoryService } from '../services/inventory.service';
import { config } from '../config';

const SHAPOORJI_ID = '00000000-0000-0000-0000-000000000001';

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

export const placeOrder = asyncHandler(async (req: Request, res: Response) => {
  const { guestName, guestPhone, guestAddress, items, paymentMethod, notes, storeId, zoneName, deliveryPreference, deliveryNote } = req.body;
  if (!guestName || !guestPhone || !guestAddress || !items?.length || !paymentMethod) {
    res.status(400).json({ success: false, error: 'Missing required fields' });
    return;
  }
  const cleanPhone = String(guestPhone).replace(/\D/g, '');
  if (cleanPhone.length !== 10) { res.status(400).json({ success: false, error: 'Invalid phone number' }); return; }
  if (!['cod', 'upi', 'phonepay'].includes(paymentMethod)) { res.status(400).json({ success: false, error: 'Invalid payment method' }); return; }
  if (!Array.isArray(items) || !items.every((i: any) => i.productId && i.price > 0 && Number.isInteger(i.quantity) && i.quantity > 0)) {
    res.status(400).json({ success: false, error: 'Invalid items' }); return;
  }
  // Fetch store name for fulfilled_by
  const storeResult = await query<{ name: string }>(`SELECT name FROM mart_stores WHERE id = $1`, [storeId || SHAPOORJI_ID]);
  const storeName = storeResult.rows[0]?.name || 'Gokez Mart';
  const result = await OrderService.create({
    guestName, guestPhone, guestAddress, items, paymentMethod, notes,
    storeId: storeId || SHAPOORJI_ID,
    storeName,
    zoneName, deliveryPreference, deliveryNote,
  });
  // Notify store admins of new order (non-blocking)
  PushService.notifyStoreAdmins(storeId || SHAPOORJI_ID, {
    title: '🛒 New Order!',
    body: `${guestName} placed an order for ₹${result.total}`,
    url: '/orders',
  }).catch(() => {});
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
    role: string; store_id: string | null;
  }>(
    `SELECT id, username, password_hash, name, email, phone, role, store_id
     FROM mart_admins WHERE username = $1`, [username]
  );
  const admin = result.rows[0];
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }
  await query(`UPDATE mart_admins SET last_login_at = NOW() WHERE id = $1`, [admin.id]);
  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role, storeId: admin.store_id, jti: require('uuid').v4() },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as any
  );
  res.json({ success: true, data: {
    token,
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

export const adminGetCatalog = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { categoryId } = req.query;
  const result = await query(
    `SELECT p.id, p.name, p.description, p.photo_url as "photoUrl",
            p.weight_options as "weightOptions", p.category_id as "categoryId",
            c.name as "categoryName", c.icon as "categoryIcon"
     FROM mart_products p
     LEFT JOIN mart_categories c ON c.id = p.category_id
     WHERE p.is_catalog = true
     ${categoryId ? 'AND p.category_id = $1' : ''}
     ORDER BY c.sort_order ASC, p.name ASC`,
    categoryId ? [categoryId] : []
  );
  res.json({ success: true, data: result.rows });
});

export const adminAssignFromCatalog = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { price, unit, discountPercent } = req.body;
  if (!price || !unit) { res.status(400).json({ success: false, error: 'price and unit are required' }); return; }
  await ProductService.assignToStore(req.params.id, storeId, { price: parseFloat(price), unit, discountPercent: parseFloat(discountPercent) || 0 });
  res.json({ success: true, message: 'Product assigned to store' });
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
        title: 'Gokez Mart 🛒',
        body: `🛵 Rider is on the way! Should reach you within ${etaLabel}`,
        url: '/orders',
      }).catch(() => {});
    }
  }
  res.json({ success: true, message: `${orderIds.length} order(s) dispatched`, batchId });
});

export const adminUpdateOrderStatus = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { status, failureReason } = req.body;
  // Save failure reason if provided
  if (status === 'failed_delivery' && failureReason) {
    await query(`UPDATE mart_orders SET failure_reason = $1 WHERE id = $2`, [failureReason, req.params.id]);
  }
  const order = await OrderService.updateStatus(req.params.id, status);
  if (!order) { res.status(404).json({ success: false, error: 'Order not found' }); return; }

  const FAILURE_MESSAGES: Record<string, string> = {
    refused:       '😔 Your order could not be delivered as it was refused at the door.',
    no_answer:     '😔 We tried to deliver but no one was available. Please contact us to reschedule.',
    phone_off:     '😔 We could not reach you for delivery. Please contact us to reschedule.',
    wrong_address: '😔 We could not locate your address. Please update your address and contact us.',
  };

  const STATUS_MESSAGES: Record<string, string> = {
    confirmed:        '✅ Order confirmed! We\'re getting it ready.',
    preparing:        '🍳 Your order is being prepared.',
    out_for_delivery: '🛵 Rider is heading to the store to pick up your order.',
    picked_up:        '🛵 Rider is on the way! Should reach you within 10-15 mins.',
    delivered:        '🎉 Order delivered! Enjoy your groceries.',
    cancelled:        '❌ Your order has been cancelled.',
    failed_delivery:  failureReason && FAILURE_MESSAGES[failureReason]
                        ? FAILURE_MESSAGES[failureReason]
                        : '😔 We were unable to deliver your order. Please contact us if you need help.',
  };

  if (STATUS_MESSAGES[status]) {
    const custResult = await query<{ customer_id: string | null; store_id: string | null; order_number: string }>(
      `SELECT customer_id, store_id, order_number FROM mart_orders WHERE id = $1`, [req.params.id]
    );
    const { customer_id, store_id, order_number } = custResult.rows[0] || {};

    // Notify delivery staff when order is ready to pickup
    if (status === 'ready_to_pickup' && store_id) {
      PushService.notifyStoreAdmins(store_id, {
        title: '📦 Order Ready for Pickup',
        body: `${order_number} is packed and ready — come collect from store`,
        url: '/delivery',
      }, ['delivery_staff', 'staff']).catch(() => {});
    }
    if (customer_id) {
      PushService.notifyCustomer(customer_id, {
        title: 'Gokez Mart 🛒',
        body: STATUS_MESSAGES[status],
        url: '/orders',
      }).catch(() => {});
    }
    if (status === 'failed_delivery' && store_id) {
      const reasonLabel: Record<string, string> = {
        refused: 'Customer refused', no_answer: 'No answer',
        phone_off: 'Phone not reachable', wrong_address: 'Wrong address',
      };
      PushService.notifyStoreAdmins(store_id, {
        title: '⚠️ Delivery Failed',
        body: `${order_number} — ${reasonLabel[failureReason] || 'Delivery failed'}`,
        url: '/orders',
      }).catch(() => {});
    }
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
  const existing = await query<{ status: string; customer_id: string | null; store_id: string | null; order_number: string }>(
    `SELECT status, customer_id, store_id, order_number FROM mart_orders WHERE id = $1`, [req.params.id]
  );
  const ord = existing.rows[0];
  if (!ord) { res.status(404).json({ success: false, error: 'Order not found' }); return; }
  if (['delivered','cancelled','failed_delivery','terminated'].includes(ord.status)) {
    res.status(400).json({ success: false, error: 'Order is already closed' }); return;
  }
  await query(
    `UPDATE mart_orders SET status='terminated', termination_reason=$1, terminated_by=$2, terminated_at=NOW(), updated_at=NOW() WHERE id=$3`,
    [finalReason, req.admin!.id, req.params.id]
  );
  const MSGS: Record<string,string> = {
    rider_unavailable: '😔 Sorry — your order could not be completed due to a delivery issue. You will not be charged. Please reorder.',
    store_closed:      '😔 Sorry — our store had to close unexpectedly. You will not be charged. Please reorder.',
    out_of_stock:      '😔 Sorry — an item became unavailable after dispatch. You will not be charged. Please reorder.',
    technical_issue:   '😔 Sorry — a technical issue prevented delivery. You will not be charged. Please reorder.',
    other:             '😔 Sorry — your order had to be cancelled by our team. You will not be charged. Please reorder.',
  };
  if (ord.customer_id) {
    PushService.notifyCustomer(ord.customer_id, { title: 'Gokez Mart 🛒', body: MSGS[reason] || MSGS.other, url: '/orders' }).catch(() => {});
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

export const customerGetOrders = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const orders = await OrderService.findAll({ phone: req.customer!.phone, limit: 20 });
  res.json({ success: true, data: orders });
});

export const customerCancelOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { id } = req.params;
  // Verify order belongs to this customer and is cancellable
  const result = await query<{ status: string; customer_id: string | null; store_id: string | null }>(
    `SELECT status, customer_id, store_id FROM mart_orders WHERE id = $1`, [id]
  );
  const order = result.rows[0];
  if (!order) { res.status(404).json({ success: false, error: 'Order not found' }); return; }
  if (order.customer_id !== req.customer!.id) { res.status(403).json({ success: false, error: 'Not your order' }); return; }
  if (!['pending', 'confirmed'].includes(order.status)) {
    res.status(400).json({ success: false, error: 'Order cannot be cancelled at this stage' }); return;
  }
  await query(`UPDATE mart_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
  // Notify store admins
  if (order.store_id) {
    PushService.notifyStoreAdmins(order.store_id, {
      title: '❌ Order Cancelled',
      body: `Customer cancelled order`,
      url: '/orders',
    }).catch(() => {});
  }
  res.json({ success: true, message: 'Order cancelled' });
});

// ── Admin user management (super_admin only) ─────────────────────────────────

export const adminGetUsers = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const result = await query(
    `SELECT id, username, name, email, phone, role,
            store_id as "storeId",
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
  const valid = ['super_admin', 'store_owner', 'delivery_staff'];
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
  const { name, email, phone, role, storeId, password } = req.body;
  const { id } = req.params;
  // Prevent editing own role
  if (id === req.admin!.id && role && role !== req.admin!.role) {
    res.status(400).json({ success: false, error: 'Cannot change your own role' }); return;
  }
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (name !== undefined)    { fields.push(`name = $${i++}`);     params.push(name?.trim() || null); }
  if (email !== undefined)   { fields.push(`email = $${i++}`);    params.push(email?.trim() || null); }
  if (phone !== undefined)   { fields.push(`phone = $${i++}`);    params.push(phone?.trim() || null); }
  if (role !== undefined)    { fields.push(`role = $${i++}`);     params.push(role); }
  if (storeId !== undefined) { fields.push(`store_id = $${i++}`); params.push(role === 'super_admin' ? null : storeId); }
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
     RETURNING id, username, name, email, phone, role, store_id as "storeId"`,
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
  const result = await ComplianceService.submitGrievance(req.customer!.id, subject.trim(), description.trim());
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

// ── Admin photo upload ────────────────────────────────────────────────────────

export const adminUploadPhoto = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ success: false, error: 'No file uploaded' }); return; }

  const bucket = config.supabase.bucket;
  const filename = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  const uploadUrl = `${config.supabase.url}/storage/v1/object/${bucket}/${filename}`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.supabase.serviceRoleKey}`,
      'Content-Type': req.file.mimetype,
      'x-upsert': 'false',
      'cache-control': 'max-age=31536000',
    },
    body: req.file.buffer,
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
  const storeId = resolveStoreId(req);
  const { qty, stockUnit, note } = req.body;
  if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) {
    res.status(400).json({ success: false, error: 'qty must be a positive number' }); return;
  }
  if (!stockUnit) {
    res.status(400).json({ success: false, error: 'stockUnit is required' }); return;
  }
  const result = await InventoryService.restock(
    req.params.productId, storeId, parseFloat(qty), stockUnit, note || null, req.admin!.id
  );
  res.json({ success: true, data: result });
});

export const adminGetInventoryHistory = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const data = await InventoryService.getHistory(req.params.productId, storeId);
  res.json({ success: true, data });
});

export const adminSetProductStock = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { qty, stockUnit } = req.body;
  if (qty === undefined || isNaN(parseFloat(qty)) || parseFloat(qty) < 0) {
    res.status(400).json({ success: false, error: 'qty must be a non-negative number' }); return;
  }
  if (!stockUnit) {
    res.status(400).json({ success: false, error: 'stockUnit is required' }); return;
  }
  const result = await InventoryService.setStock(
    req.params.productId, storeId, parseFloat(qty), stockUnit, req.admin!.id
  );
  res.json({ success: true, data: result });
});

export const adminBulkRestock = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { items, note } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ success: false, error: 'items array required' }); return;
  }
  const results = await InventoryService.bulkRestock(storeId, items, note || null, req.admin!.id);
  res.json({ success: true, data: results, message: `${results.length} product(s) restocked` });
});
