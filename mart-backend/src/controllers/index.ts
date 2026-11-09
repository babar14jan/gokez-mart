import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import path from 'path';
import { asyncHandler, AdminRequest, ADMIN_TOKEN_TYPE, isValidAdminRole, ADMIN_ROLE_LIST } from '../middleware';
import { ProductService, MartProduct, normalizeSearchAliases, normalizeProductName, normalizeLocalName } from '../services/product.service';
import { CategoryService } from '../services/category.service';
import { OrderService, buildOrderWindow, CUSTOMER_CANCEL_REASONS, CustomerCancelReason } from '../services/order.service';
import { OrderRestoreService, RESTORE_STATUSES, RestoreStatus, RestorePaymentMethod } from '../services/orderRestore.service';
import { CUSTOMER_CANCELLATION_MESSAGES } from '../utils/cancellationPolicy';
import { SettingsService } from '../services/settings.service';
import { ZoneService } from '../services/zone.service';
import { StoreService } from '../services/store.service';
import { StoreSubscriptionService, StoreSubscriptionStatus } from '../services/storeSubscription.service';
import { TeamService } from '../services/team.service';
import { CustomerAuthService } from '../services/customerAuth.service';
import { CustomerRequest } from '../middleware';
import { PushService } from '../services/push.service';
import { ComplianceService } from '../services/compliance.service';
import { query, transaction } from '../database/db';
import { InventoryService } from '../services/inventory.service';
import { CampaignService } from '../services/campaign.service';
import { PromotionService } from '../services/promotion.service';
import { HomeSectionService } from '../services/homeSection.service';
import { CustomerLeadService, LeadStatus } from '../services/customerLead.service';
import { ProductSuggestionService, SuggestionStatus, BuyerType, SuggestionRange } from '../services/productSuggestion.service';
import { FunnelService, FunnelRange } from '../services/funnel.service';
import { CustomerAnalyticsService } from '../services/customerAnalytics.service';
import { emitOrderEvent, orderEventBus, type OrderLiveEvent } from '../services/orderEventBus';
import { ProductImageAssetService } from '../services/productImageAsset.service';
import { FunnelEventService, FunnelEventName } from '../services/funnelEvent.service';
import { FunnelCartService } from '../services/funnelCart.service';
import { InstallAnalyticsService } from '../services/installAnalytics.service';
import { DailySalesService } from '../services/dailySales.service';
import { CatalogService } from '../services/catalog.service';
import { RecommendationService } from '../services/recommendation.service';
import { evaluateStoreOpen, parseIstLocalDateTime, type StoreOpenState } from '../utils/storeHours';
import { trackStream } from '../utils/sse';
import { OUTBOUND_TIMEOUTS, timeoutSignal } from '../utils/timeouts';
import { config } from '../config';
import { badRequest, forbidden } from '../utils/apiError';
import { isValidCustomerPhone, normalizeCustomerPhone } from '../utils/customerPhone';
import { v4 as uuidv4 } from 'uuid';

const SHAPOORJI_ID = '00000000-0000-0000-0000-000000000001';

async function autoConfirmOrder(id: string): Promise<void> {
  try {
    const order = await OrderService.autoConfirmPending(id);
    if (!order) return;

    PushService.notifyOrderRecipient(order.id, {
      title: `Order #${order.orderNumber} update`,
      body: `✅ Order #${order.orderNumber} confirmed. We're preparing your order.`,
      url: '/orders',
      tag: `order-${order.id}`,
    }).catch(() => {});
    const fulfilmentStores = await query<{ storeId: string }>(
      `SELECT DISTINCT store_id as "storeId"
         FROM mart_order_items
        WHERE order_id = $1 AND store_id IS NOT NULL`,
      [order.id]
    );
    emitOrderEvent({
      type: 'order.updated',
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'confirmed',
        storeId: order.storeId,
        storeIds: fulfilmentStores.rows.map(row => row.storeId),
      },
    });
  } catch (error) {
    console.error(`[orders] automatic confirmation failed for ${id}:`, error);
  }
}

async function autoStartPreparingOrder(id: string): Promise<void> {
  try {
    const order = await OrderService.autoStartPreparing(id);
    if (!order) return;

    PushService.notifyOrderRecipient(order.id, {
      title: `Order #${order.orderNumber} update`,
      body: `Order #${order.orderNumber} is being prepared.`,
      url: '/orders',
      tag: `order-${order.id}`,
    }).catch(() => {});
    const fulfilmentStores = await query<{ storeId: string }>(
      `SELECT DISTINCT store_id as "storeId"
         FROM mart_order_items
        WHERE order_id = $1 AND store_id IS NOT NULL`,
      [order.id]
    );
    emitOrderEvent({
      type: 'order.updated',
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'preparing',
        storeId: order.storeId,
        storeIds: fulfilmentStores.rows.map(row => row.storeId),
      },
    });
  } catch (error) {
    console.error(`[orders] automatic preparation failed for ${id}:`, error);
  }
}

/** Recover automatic order transitions that were due during a process restart. */
export async function recoverAutomaticOrderTransitions(): Promise<void> {
  const { pendingIds, confirmedIds } = await OrderService.getOverdueAutomaticTransitions();
  await Promise.all(pendingIds.map(autoConfirmOrder));
  await Promise.all(confirmedIds.map(autoStartPreparingOrder));
}

type PreparedImage = { buffer: Buffer; extension: string; mimeType: string };
type PreparedProductImages = {
  thumbnail: PreparedImage;
  large: PreparedImage;
};

function hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  if (latitude == null && longitude == null) return true;
  return typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

async function prepareImage(buffer: Buffer, maxDimension?: number): Promise<PreparedImage> {
  // sharp is a native module (libvips) and it is only needed when an image is
  // actually being re-encoded, which is rare. Importing it lazily keeps it out
  // of the boot path, so the process does not hold ~11 MB of native bindings
  // for the whole time it is running.
  const { default: sharp } = await import('sharp');
  const image = sharp(buffer, { failOn: 'error' }).rotate();
  if (maxDimension) {
    image.resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
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

async function prepareAvatarImage(buffer: Buffer): Promise<PreparedImage> {
  const { default: sharp } = await import('sharp');
  const source = sharp(buffer, { failOn: 'error' }).rotate();
  const metadata = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) {
    throw new Error('Only JPEG, PNG, and WebP images are supported');
  }
  return {
    buffer: await source.resize(256, 256, { fit: 'cover', position: 'centre' }).webp({ quality: 80, effort: 4 }).toBuffer(),
    extension: 'webp',
    mimeType: 'image/webp',
  };
}

async function prepareProductImages(buffer: Buffer): Promise<PreparedProductImages> {
  const { default: sharp } = await import('sharp');
  const source = sharp(buffer, { failOn: 'error' }).rotate();
  const metadata = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) {
    throw new Error('Only JPEG, PNG, and WebP images are supported');
  }
  const sourceMax = Math.max(metadata.width || 0, metadata.height || 0);
  const encode = async (maxDimension: number): Promise<PreparedImage> => ({
    buffer: await source.clone().resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    }).webp({ quality: maxDimension <= 160 ? 72 : maxDimension <= 480 ? 76 : 82, effort: 4 }).toBuffer(),
    extension: 'webp',
    mimeType: 'image/webp',
  });

  const thumbnail = await encode(160);
  const large = sourceMax <= 160 ? thumbnail : await encode(480);
  return { thumbnail, large };
}

// Helper: resolve storeId from request (admin JWT or query param storeId)
function resolveStoreId(req: AdminRequest): string {
  // Store manager → always their store
  if (req.admin?.storeId) return req.admin.storeId;
  // Super admin → can pass storeId in query or body
  return (req.query.storeId || req.body?.storeId || SHAPOORJI_ID) as string;
}

// ── Inventory store scoping ───────────────────────────────────────────────────
// A zone's head store (primary_store_id) is operationally responsible for the
// whole zone, so an admin account bound to that store may manage the inventory
// and product listings of every store tagged into the zone. Everyone else
// stays pinned to their own store; super admins may target any store. This is
// deliberately narrower than the general resolveStoreId above: other pages
// keep their existing single-store scope.
async function canManageStore(
  admin: NonNullable<AdminRequest['admin']>,
  storeId: string
): Promise<boolean> {
  if (admin.role === 'super_admin') return true;
  if (!admin.storeId) return false;
  if (admin.storeId === storeId) return true;
  const { rows } = await query(
    `SELECT 1
       FROM mart_zones z
       JOIN mart_zone_stores zs ON zs.zone_id = z.id
      WHERE z.primary_store_id = $1
        AND z.is_active = true
        AND zs.store_id = $2
      LIMIT 1`,
    [admin.storeId, storeId]
  );
  return rows.length > 0;
}

async function resolveManagedStoreId(req: AdminRequest): Promise<string> {
  const admin = req.admin!;
  const requested = (req.query.storeId || req.body?.storeId) as string | undefined;
  if (admin.role === 'super_admin') return requested || SHAPOORJI_ID;
  const ownStoreId = admin.storeId || null;
  if (!requested || requested === ownStoreId) return ownStoreId || requested || SHAPOORJI_ID;
  if (await canManageStore(admin, requested)) return requested;
  throw forbidden('You do not have access to that store');
}

// ── Daily sales access ────────────────────────────────────────────────────────
// Daily Sales is a head-store responsibility. Only the owner/manager bound to a
// zone's primary store (plus super admins) may view or edit the ledger; owners
// and managers of member stores are denied even though they can manage their
// own inventory.
async function isHeadStore(storeId: string | null): Promise<boolean> {
  if (!storeId) return false;
  const { rows } = await query(
    `SELECT 1 FROM mart_zones WHERE primary_store_id = $1 AND is_active = true LIMIT 1`,
    [storeId]
  );
  return rows.length > 0;
}

async function canAccessDailySales(admin: { role: string; storeId: string | null }): Promise<boolean> {
  if (admin.role === 'super_admin') return true;
  if (admin.role !== 'store_owner' && admin.role !== 'store_manager') return false;
  return isHeadStore(admin.storeId);
}

async function assertDailySalesAccess(req: AdminRequest): Promise<void> {
  if (!(await canAccessDailySales(req.admin!))) {
    throw forbidden('Daily Sales is only available to the head store owner/manager');
  }
}

// ── Public controllers ────────────────────────────────────────────────────────

export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await CategoryService.findAll(true);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: categories });
});

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const { categoryId, storeId, zoneId } = req.query;
  res.set('Cache-Control', 'no-store');
  // A multi-store zone serves the merged catalog of every tagged store, deduped
  // per product with the zone head's listing winning ties.
  if (zoneId) {
    const zone = await ZoneService.findById(zoneId as string);
    if (zone) {
      const products = await ProductService.findAllForZone(zoneId as string, {
        categoryId: categoryId as string,
        excludeHidden: true,
        activeCategoryOnly: true,
      });
      res.json({ success: true, data: products });
      return;
    }
  }
  const resolvedStoreId = (storeId as string) || SHAPOORJI_ID;
  const settings = await SettingsService.getPublic(resolvedStoreId);
  const products = await ProductService.findAll({
    storeId: resolvedStoreId,
    categoryId: categoryId as string,
    excludeHidden: true,
    activeCategoryOnly: true,
    onlyFulfillableBundles: settings.inventory_tracking === 'true' && settings.auto_out_of_stock === 'on_zero',
  });
  res.json({ success: true, data: products });
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.query;
  const product = await ProductService.findById(req.params.id, storeId as string);
  if (!product) { res.status(404).json({ success: false, error: 'Product not found' }); return; }
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: product });
});

export const getPublicSettings = asyncHandler(async (req: Request, res: Response) => {
  const requestedStoreId = (req.query.storeId as string) || SHAPOORJI_ID;
  // A multi-store zone presents its head store as the face of the zone and
  // answers open/close from the zone's own hours + zone settings. The store
  // path below is the legacy single-store behaviour.
  let openState: StoreOpenState | null = null;
  let effectiveHours: Record<string, unknown> | null = null;
  let nameOverride: string | null = null;
  let addressOverride: string | null = null;
  let zoneName: string | null = null;
  const zoneId = req.query.zoneId as string | undefined;
  const zone = zoneId ? await ZoneService.findById(zoneId) : null;
  const effectiveStoreId = zone?.primaryStoreId ?? requestedStoreId;
  const effectiveZone = zone ? await ZoneService.getEffectiveSettings(zone.id) : null;
  const settings = effectiveZone?.settings ?? await SettingsService.getPublic(effectiveStoreId);
  if (zoneId) {
    if (zone) {
      openState = await ZoneService.getOpenState(zone.id);
      effectiveHours = zone.openingHours as Record<string, unknown> | null;
      nameOverride = zone.primaryStore?.name ?? null;
      addressOverride = zone.primaryStore?.address ?? null;
      zoneName = zone.name;
    }
  }
  // Open/closed is computed here rather than in the browser so there is exactly
  // one implementation of the schedule, and so the answer cannot depend on the
  // customer's device clock or timezone. The storefront re-fetches at
  // nextOpenAt to pick up the change instead of re-deriving it locally.
  const store = await StoreService.findById(effectiveStoreId);
  if (!zoneId && !openState) {
    const closure = { from: settings.store_closed_from, until: settings.store_closed_until };
    openState = evaluateStoreOpen(store?.openingHours, settings.store_open, new Date(), closure);
  }
  // Store name and address have a single source of truth: mart_stores (edited on
  // the hub Stores page). They used to live in mart_settings too, which let the
  // storefront show a different name/address from receipts. Overlay the store
  // record so the storefront, receipts and tracking all read the same values.
  // A zone's head store overrides again so the customer sees the zone face.
  const merged = {
    ...settings,
    store_name: nameOverride ?? store?.name ?? settings.store_name ?? '',
    store_address: addressOverride ?? store?.address ?? settings.store_address ?? '',
  };
  // The raw schedule rides along so the storefront can offer scheduled delivery
  // slots that run open→close on the store's own clock (IST), rather than
  // guessing a window. Null when the store posts no hours.
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      ...merged,
      openState,
      openingHours: effectiveHours ?? store?.openingHours ?? null,
      zoneId: zone?.id ?? null,
      zoneName,
    },
  });
});

/**
 * One tiny fingerprint of the whole public catalog. The storefront polls this
 * every few minutes and only re-downloads products/categories/settings/sections
 * when the stamp actually changed — so a quiet store costs a few indexed
 * aggregates instead of four full payload queries per client per poll.
 *
 * The open/closed flip is wall-clock, not database, so the current state and
 * the next boundary instant (closing when open, opening when closed) are folded
 * in too; otherwise the stamp would sit still across an opening-hours edge.
 */
export const getCatalogStamp = asyncHandler(async (req: Request, res: Response) => {
  const storeId = (req.query.storeId as string) || SHAPOORJI_ID;
  const zoneId = req.query.zoneId as string | undefined;
  const zone = zoneId ? await ZoneService.findById(zoneId) : null;
  const [dbStamp, settings, store] = await Promise.all([
    zone
      ? CatalogService.getZoneStamp(zoneId as string)
      : CatalogService.getStamp(storeId),
    SettingsService.getPublic(zone?.primaryStoreId ?? storeId),
    StoreService.findById(storeId),
  ]);
  // The scheduled closure has to be part of this, not just the weekly hours:
  // a store that schedules a closure, or reaches the end of one, has changed
  // its open state without anything in the database being touched, so without
  // it here the storefront would never refetch and the banner would never
  // appear or disappear.
  let openState: StoreOpenState | null = null;
  if (zone) {
    openState = await ZoneService.getOpenState(zone.id);
  }
  if (!openState) {
    const closure = { from: settings.store_closed_from, until: settings.store_closed_until };
    openState = evaluateStoreOpen(store?.openingHours, settings.store_open, new Date(), closure);
  }
  const boundary = openState.isOpen ? openState.closesAt : openState.nextOpenAt;
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: { stamp: `${dbStamp}:${zoneId ? 'z' : 's'}:${openState.isOpen ? 'o' : 'c'}:${boundary ?? '-'}:${openState.closedUntilLabel ?? '-'}` } });
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
      signal: timeoutSignal(OUTBOUND_TIMEOUTS.geocode),
    });
    if (!response.ok) throw new Error(`Reverse geocoding failed: ${response.status}`);
    const result: any = await response.json();
    const address = result.address || {};
    res.json({
      success: true,
      data: {
        house: address.house_number || address.house_name || '',
        building: address.building || address.residential || '',
        locality: address.road || address.pedestrian || address.neighbourhood || address.quarter || address.suburb || address.village || '',
        landmark: address.amenity || address.shop || address.office || address.leisure || address.tourism || '',
        city: address.city || address.town || address.municipality || address.village || address.county || address.state_district || '',
        pincode: address.postcode || '',
      },
    });
  } catch {
    res.status(503).json({ success: false, error: 'Could not look up this location. Please enter your address manually.' });
  }
});

export const placeOrder = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { guestName, guestPhone, guestAddress, guestAddressLabel, items, notes, storeId, zoneId, zoneName, deliveryPreference, deliveryNote, scheduledFor, scheduledLabel, campaignId, couponCode, latitude, longitude } = req.body;
  let suppliedName = typeof guestName === 'string' ? guestName.trim().replace(/\s+/g, ' ') : '';
  // A signed-in order is identified by the verified phone, not by the name the
  // client posts. An account that never saved a name sends the 'Customer'
  // placeholder (or blank), which would otherwise be frozen into the order and
  // shown on the hub. Prefer the name already on the account so a returning
  // verified customer is never recorded as "Customer".
  if (req.customer && (!suppliedName || suppliedName === 'Customer')) {
    const nameRow = await query<{ name: string | null }>(
      `SELECT name FROM mart_customers WHERE id = $1`,
      [req.customer.id]
    );
    const storedName = nameRow.rows[0]?.name?.trim().replace(/\s+/g, ' ');
    // Only adopt a stored name that would itself pass the validation below;
    // otherwise a bad/legacy value would reject the order of a paying customer.
    if (storedName && storedName.length >= 2 && storedName.length <= 80 && /\p{L}/u.test(storedName)) {
      suppliedName = storedName;
    }
  }
  const normalizedName = suppliedName || (req.customer ? 'Customer' : '');
  const normalizedAddress = typeof guestAddress === 'string' ? guestAddress.trim() : '';
  if (!normalizedName || !guestPhone || !normalizedAddress || !items?.length) {
    res.status(400).json({ success: false, error: 'Missing required fields' });
    return;
  }
  const cleanPhone = normalizeCustomerPhone(guestPhone);
  if (normalizedName.length < 2 || normalizedName.length > 80 || !/\p{L}/u.test(normalizedName)) {
    res.status(400).json({ success: false, error: 'Enter a valid name' }); return;
  }
  if (!isValidCustomerPhone(cleanPhone)) { res.status(400).json({ success: false, error: 'Enter a valid 10-digit mobile number' }); return; }
  if (req.customer && req.customer.phone !== cleanPhone) {
    res.status(400).json({ success: false, error: 'Use your verified phone number to place this order' }); return;
  }
  if (normalizedAddress.length < 10 || normalizedAddress.length > 500) {
    res.status(400).json({ success: false, error: 'Enter a complete delivery address' }); return;
  }
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
  const requestedStoreId = storeId || SHAPOORJI_ID;
  const zone = typeof zoneId === 'string' ? await ZoneService.findById(zoneId) : null;
  if (zoneId && (!zone || !zone.isActive || !zone.primaryStoreId)) {
    res.status(400).json({ success: false, error: 'Selected delivery zone is unavailable' }); return;
  }
  if (zone && storeId && storeId !== zone.primaryStoreId) {
    res.status(400).json({ success: false, error: 'Selected store does not match the delivery zone' }); return;
  }
  const resolvedStoreId = zone?.primaryStoreId ?? requestedStoreId;
  // Fetch store name for fulfilled_by
  const storeResult = await query<{ name: string }>(`SELECT name FROM mart_stores WHERE id = $1`, [resolvedStoreId]);
  const storeName = storeResult.rows[0]?.name || 'Gokez Mart';

  const result = await OrderService.create({
    guestName: normalizedName, guestPhone: cleanPhone, guestAddress: normalizedAddress, items, notes,
    guestAddressLabel: typeof guestAddressLabel === 'string' && guestAddressLabel.trim()
      ? guestAddressLabel.trim().slice(0, 24)
      : undefined,
    storeId: resolvedStoreId,
    storeName,
    zoneId: zone?.id,
    zoneName: zone?.name ?? zoneName, deliveryPreference, deliveryNote, scheduledFor, scheduledLabel,
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
  if (!result.duplicate) {
    const fulfilmentStores = await query<{ storeId: string }>(
      `SELECT DISTINCT store_id as "storeId"
         FROM mart_order_items
        WHERE order_id = $1 AND store_id IS NOT NULL`,
      [result.orderId]
    );
    emitOrderEvent({
      type: 'order.created',
      order: {
        id: result.orderId,
        orderNumber: result.orderNumber,
        status: 'pending',
        total: result.total,
        guestName: normalizedName,
        storeId: storeId || SHAPOORJI_ID,
        storeIds: fulfilmentStores.rows.map(row => row.storeId),
      },
    });
    setTimeout(() => { void autoConfirmOrder(result.orderId); }, 2000);
    setTimeout(() => { void autoStartPreparingOrder(result.orderId); }, 3 * 60 * 1000);
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
  // Attach each zone's live open/close state (zone hours + zone settings,
  // falling back to the head store's) so the storefront never re-derives it.
  for (const zone of zones) {
    zone.openState = await ZoneService.getOpenState(zone.id);
  }
  res.json({ success: true, data: zones });
});

export const getStores = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await StoreService.findAll();
  const activeStores = [];
  for (const store of stores) {
    if (store.isActive && await StoreSubscriptionService.isActive(store.id)) activeStores.push(store);
  }
  res.json({ success: true, data: activeStores });
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
  if (admin.role !== 'super_admin' && !(await StoreSubscriptionService.adminHasActiveSubscription(admin.id))) {
    res.status(403).json({ success: false, error: 'Your store subscription is not active. Contact your administrator.' });
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

  // Stamp the session row from the token's own exp so the middleware's
  // `expires_at > NOW()` check and the JWT lifetime can never disagree (this
  // used to be a hardcoded 90 days regardless of the configured expiry). The
  // fallback below only exists for a decode failure and matches the default
  // configured lifetime.
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO mart_admin_sessions (admin_id, token_jti, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [admin.id, jti, req.ip || null, req.headers['user-agent'] || null, expiresAt]
  );

  // A login used to revoke every session beyond the two most recent, so
  // signing in on a second device (or re-signing in on the same phone) silently
  // kicked the admin off everywhere else — the next API call got 401 "Session
  // expired or revoked" and the hub bounced to /login. Sessions now end only
  // when revoked by logout (POST /admin/logout) or by expiry.

  res.json({ success: true, data: {
    token,
    id: admin.id,
    username: admin.username,
    name: admin.name || admin.username,
    email: admin.email,
    phone: admin.phone,
    role: admin.role,
    storeId: admin.store_id,
    canAccessDailySales: await canAccessDailySales({ role: admin.role, storeId: admin.store_id }),
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

export const adminRefreshSession = asyncHandler(async (req: AdminRequest, res: Response) => {
  const token = req.headers.authorization?.slice(7);
  const payload = token ? jwt.verify(token, config.jwt.secret) as { jti?: string } : null;
  if (!payload?.jti) {
    res.status(401).json({ success: false, error: 'Invalid session' });
    return;
  }

  const refreshedToken = jwt.sign(
    {
      id: req.admin!.id,
      username: req.admin!.username,
      role: req.admin!.role,
      type: ADMIN_TOKEN_TYPE,
      storeId: req.admin!.storeId,
      jti: payload.jti,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as any
  );
  const decoded = jwt.decode(refreshedToken) as { exp?: number } | null;
  if (!decoded?.exp) throw new Error('Unable to determine refreshed session expiry');

  await query(
    `UPDATE mart_admin_sessions SET expires_at = $1 WHERE token_jti = $2 AND is_active = true`,
    [new Date(decoded.exp * 1000), payload.jti]
  );
  res.json({ success: true, data: { token: refreshedToken } });
});

export const adminGetMe = asyncHandler(async (req: AdminRequest, res: Response) => {
  const result = await query(
    `SELECT id, username, name, email, phone, role, store_id as "storeId", last_login_at, created_at
     FROM mart_admins WHERE id = $1`,
    [req.admin!.id]
  );
  if (!result.rows[0]) { res.status(404).json({ success: false, error: 'Admin not found' }); return; }
  res.json({ success: true, data: {
    ...result.rows[0],
    canAccessDailySales: await canAccessDailySales(req.admin!),
  }});
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
  const storeId = await resolveManagedStoreId(req);
  const products = await ProductService.findAll({ storeId });
  res.json({ success: true, data: products });
});

export const adminCreateProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const isCombo = Array.isArray(req.body.bundleComponents);
  const isHeadComboManager = ['store_owner', 'store_manager'].includes(req.admin!.role)
    && await isHeadStore(req.admin!.storeId);
  if (!isCombo && req.admin!.role !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Only super admins can create products' });
    return;
  }
  if (isCombo && req.admin!.role !== 'super_admin' && !isHeadComboManager) {
    res.status(403).json({ success: false, error: 'Only the zone head owner or manager can create combos' });
    return;
  }
  const storeId = await resolveManagedStoreId(req);
  if (isCombo && req.admin!.role !== 'super_admin' && storeId !== req.admin!.storeId) {
    res.status(403).json({ success: false, error: 'Combos can only be created for your own head store' });
    return;
  }
  const product = isCombo
    ? await ProductService.createBundle({ ...req.body, storeId, adminId: req.admin!.id, components: req.body.bundleComponents })
    : await ProductService.create({ ...req.body, storeId });
  res.status(201).json({ success: true, data: product });
});

export const adminGetProductBundleComponents = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = await resolveManagedStoreId(req);
  const product = await ProductService.findById(req.params.id, storeId);
  if (!product?.isBundle) { res.status(404).json({ success: false, error: 'Combo not found' }); return; }
  const components = await ProductService.getBundleComponents(req.params.id, storeId);
  res.json({ success: true, data: components });
});

export const adminUpdateProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = await resolveManagedStoreId(req);
  const isSuperAdmin = req.admin!.role === 'super_admin';
  const existing = await ProductService.findById(req.params.id, storeId);
  if (!existing) { res.status(404).json({ success: false, error: 'Product not found' }); return; }
  const isHeadComboManager = ['store_owner', 'store_manager'].includes(req.admin!.role)
    && await isHeadStore(req.admin!.storeId);
  if (existing.isBundle && !isSuperAdmin && !isHeadComboManager) {
    res.status(403).json({ success: false, error: 'Only the zone head owner or manager can edit combos' });
    return;
  }
  if (existing.isBundle && !isSuperAdmin && storeId !== req.admin!.storeId) {
    res.status(403).json({ success: false, error: 'Combos can only be edited for your own head store' });
    return;
  }
  let data: Partial<MartProduct> & { storeId?: string } = { storeId };
  if (existing.isBundle) {
    data = { ...req.body, storeId, adminId: req.admin!.id };
  } else {
    data.price = req.body.price;
    data.unit = req.body.unit;
    data.approxWeight = req.body.approxWeight;
    data.discountPercent = req.body.discountPercent;
    data.availabilityStatus = req.body.availabilityStatus;
    data.isAvailable = req.body.isAvailable;
    data.sortOrder = req.body.sortOrder;
  }
  if (existing.isBundle && req.body.bundleComponents !== undefined) {
    await ProductService.replaceBundleComponents(req.params.id, storeId, req.body.bundleComponents);
  }
  const product = await ProductService.update(req.params.id, data);
  res.json({ success: true, data: product });
});

export const adminDeleteProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = await resolveManagedStoreId(req);
  await ProductService.removeFromStore(req.params.id, storeId);
  res.json({ success: true, message: 'Product removed from store' });
});

// ── Master catalog ────────────────────────────────────────────────────────────

// Browse catalog — all authenticated roles
export const adminGetCatalog = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { categoryId, search } = req.query;
  const conditions: string[] = ['p.is_catalog = true', 'p.is_bundle = false'];
  const params: unknown[] = [];
  let i = 1;
  if (categoryId) { conditions.push(`p.category_id = $${i++}`); params.push(categoryId); }
  if (search) {
    conditions.push(`(p.name ILIKE $${i} OR p.product_code ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }
  const result = await query(
    `SELECT p.id, p.product_code as "productCode", p.name, p.local_name as "localName", p.search_aliases as "searchAliases", p.description,
            p.photo_url as "photoUrl", p.photos as "photos", p.photo_variants as "photoVariants", p.category_id as "categoryId",
            c.name as "categoryName", c.icon as "categoryIcon"
     FROM mart_products p
     LEFT JOIN mart_categories c ON c.id = p.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.sort_order ASC NULLS LAST, p.name ASC`,
    params
  );
  const rows = result.rows as Array<Record<string, unknown>>;
  const assetVariants = await ProductImageAssetService.getCatalogAssetVariants(rows.map(row => String(row.id)));
  res.json({
    success: true,
    data: rows.map(row => {
      const photos = Array.isArray(row.photos) ? row.photos.map(photo => String(photo)) : [];
      const generated = assetVariants.get(String(row.id)) || [];
      const existing = Array.isArray(row.photoVariants) ? row.photoVariants as Array<Record<string, unknown>> : [];
      const generatedByLargeUrl = new Map(generated.map(variant => [variant.largeUrl, variant]));
      const existingByLargeUrl = new Map(existing
        .filter(variant => typeof variant?.largeUrl === 'string')
        .map(variant => [String(variant.largeUrl), variant]));
      const photoVariants = photos.map(largeUrl => generatedByLargeUrl.get(largeUrl)
        || existingByLargeUrl.get(largeUrl)
        || { thumbnailUrl: largeUrl, largeUrl });
      return { ...row, photos, photoVariants };
    }),
  });
});

// Create catalog product — super_admin only (name + photo + category, no price/store)
export const adminCreateCatalogProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, localName, searchAliases, description, photoUrl, photos, photoVariants, imageAssetIds, categoryId, photoLocalPath } = req.body;
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'name is required' }); return; }

  let resolvedPhotoUrl = photoUrl;
  let resolvedPhotos = photos;
  let resolvedPhotoVariants = photoVariants;
  let resolvedImageAssetIds = imageAssetIds;

  if (typeof photoLocalPath === 'string' && photoLocalPath.trim()) {
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    const raw = photoLocalPath.trim();
    const candidates: string[] = [];
    if (path.isAbsolute(raw)) {
      candidates.push(raw);
    } else {
      const cleaned = raw.replace(/^\.?\//, '');
      candidates.push(path.join(uploadsDir, cleaned));
      candidates.push(path.join(uploadsDir, 'products', cleaned));
      if (!cleaned.startsWith('products/') && !cleaned.startsWith('products\\')) {
        candidates.push(path.join(uploadsDir, 'products', path.basename(cleaned)));
      }
    }
    let resolvedFile: string | null = null;
    for (const c of candidates) {
      const full = path.resolve(c);
      if (!full.startsWith(`${uploadsDir}${path.sep}`)) continue;
      try {
        const info = await stat(full);
        if (info.isFile()) { resolvedFile = full; break; }
      } catch {}
    }
    if (!resolvedFile) {
      res.status(400).json({ success: false, error: 'Local image file not found' });
      return;
    }

    const buffer = await readFile(resolvedFile);
    const baseName = path.basename(resolvedFile).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    const images = await prepareProductImages(buffer);
    const assetId = uuidv4();
    const filenames = new Map<PreparedImage, string>();
    const entries = Object.entries(images) as Array<[keyof PreparedProductImages, PreparedImage]>;
    for (const [variantName, variant] of entries) {
      if (!filenames.has(variant)) {
        filenames.set(variant, `products/${assetId}-${baseName || 'product'}-${variantName}.${variant.extension}`);
      }
    }

    if (config.env !== 'production' && (!config.supabase.url || !config.supabase.serviceRoleKey)) {
      await mkdir(path.join(uploadsDir, 'products'), { recursive: true });
      await Promise.all([...filenames].map(([variant, variantFilename]) => writeFile(path.join(uploadsDir, variantFilename), variant.buffer)));
      const localUrl = (variant: PreparedImage) => `${req.protocol}://${req.get('host')}/uploads/${filenames.get(variant)!}`;
      const pv = { assetId, thumbnailUrl: localUrl(images.thumbnail), largeUrl: localUrl(images.large) };
      await ProductImageAssetService.createPending({
        id: assetId, uploadedBy: req.admin!.id, thumbnailUrl: pv.thumbnailUrl, largeUrl: pv.largeUrl,
        thumbnailKey: filenames.get(images.thumbnail)!, largeKey: filenames.get(images.large)!, storageDriver: 'local',
      });
      resolvedPhotoUrl = pv.largeUrl;
      resolvedPhotos = [pv.largeUrl];
      resolvedPhotoVariants = [pv];
      resolvedImageAssetIds = [assetId];
    } else {
      const uploaded = await Promise.all([...filenames].map(async ([variant, variantFilename]) => {
        const uploadRes = await fetch(`${config.supabase.url}/storage/v1/object/${config.supabase.bucket}/${variantFilename}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.supabase.serviceRoleKey}`,
            'Content-Type': variant.mimeType,
            'x-upsert': 'false',
            'cache-control': 'max-age=31536000, immutable',
          },
          body: variant.buffer,
          signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
        });
        if (!uploadRes.ok) {
          await uploadRes.text();
          throw new Error('Upload failed. Please try again.');
        }
        return [variant, `${config.supabase.url}/storage/v1/object/public/${config.supabase.bucket}/${variantFilename}`] as const;
      }));
      const urls = new Map(uploaded);
      const pv = {
        assetId,
        thumbnailUrl: urls.get(images.thumbnail)!,
        largeUrl: urls.get(images.large)!,
      };
      await ProductImageAssetService.createPending({
        id: assetId, uploadedBy: req.admin!.id, thumbnailUrl: pv.thumbnailUrl, largeUrl: pv.largeUrl,
        thumbnailKey: filenames.get(images.thumbnail)!, largeKey: filenames.get(images.large)!, storageDriver: 'supabase',
      });
      resolvedPhotoUrl = pv.largeUrl;
      resolvedPhotos = [pv.largeUrl];
      resolvedPhotoVariants = [pv];
      resolvedImageAssetIds = [assetId];
    }
  }

  const product = await ProductService.createCatalogProduct({
    name: name.trim(),
    localName,
    searchAliases,
    description,
    photoUrl: resolvedPhotoUrl,
    photos: resolvedPhotos,
    photoVariants: resolvedPhotoVariants,
    imageAssetIds: resolvedImageAssetIds,
    adminId: req.admin!.id,
    categoryId,
  });
  res.status(201).json({ success: true, data: product });
});

// Update catalog product — super_admin only
export const adminUpdateCatalogProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, localName, searchAliases, description, photoUrl, photos, photoVariants, imageAssetIds, categoryId } = req.body;
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (name !== undefined)        { fields.push(`name = $${i++}`);        params.push(normalizeProductName(name)); }
  if (localName !== undefined)   { fields.push(`local_name = $${i++}`);  params.push(normalizeLocalName(localName)); }
  if (searchAliases !== undefined) { fields.push(`search_aliases = $${i++}`); params.push(normalizeSearchAliases(searchAliases)); }
  if (description !== undefined) { fields.push(`description = $${i++}`); params.push(description); }
  if (photos !== undefined) {
    fields.push(`photos = $${i++}::jsonb`); params.push(JSON.stringify(photos));
    fields.push(`photo_url = $${i++}`);
    params.push(photoUrl || (Array.isArray(photos) && photos[0]) || null);
  }
  else if (photoUrl !== undefined) { fields.push(`photo_url = $${i++}`); params.push(photoUrl); }
  if (photoVariants !== undefined) { fields.push(`photo_variants = $${i++}::jsonb`); params.push(JSON.stringify(photoVariants)); }
  if (categoryId !== undefined)  { fields.push(`category_id = $${i++}`); params.push(categoryId || null); }
  if (!fields.length) { res.status(400).json({ success: false, error: 'Nothing to update' }); return; }
  fields.push(`updated_at = NOW()`);
  params.push(req.params.id);
  const result = await transaction(async client => {
    const updated = await client.query(
      `UPDATE mart_products SET ${fields.join(', ')} WHERE id = $${i} AND is_catalog = true AND is_bundle = false
      RETURNING id, product_code as "productCode", name, local_name as "localName", search_aliases as "searchAliases", description, photo_url as "photoUrl", photos as "photos", photo_variants as "photoVariants", category_id as "categoryId"`,
      params
    );
    if (updated.rows[0] && imageAssetIds !== undefined) {
      await ProductImageAssetService.syncProductAssets(client, req.params.id, imageAssetIds, req.admin!.id);
    }
    return updated;
  });
  if (!result.rows[0]) { res.status(404).json({ success: false, error: 'Catalog product not found' }); return; }
  const row = result.rows[0] as Record<string, unknown>;
  const normalizedPhotos = Array.isArray(row.photos)
    ? row.photos.map(photo => String(photo))
    : (typeof row.photoUrl === 'string' && row.photoUrl ? [row.photoUrl] : []);
  res.json({ success: true, data: { ...row, photos: normalizedPhotos } });
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
  await transaction(async client => {
    await ProductImageAssetService.queueProductAssets(client, req.params.id);
    await client.query(`DELETE FROM mart_products WHERE id = $1 AND is_catalog = true AND is_bundle = false`, [req.params.id]);
  });
  res.json({ success: true, message: 'Catalog product deleted' });
});

// Bulk add from catalog — creates store products with name+photo only, hidden by default.
// Zone-scoped guard: the same catalog product cannot be mapped to two stores in one
// zone. Conflicting mappings are returned as a 409 so the hub can show a popup instead
// of silently creating a duplicate.
export const adminBulkAddFromCatalog = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = await resolveManagedStoreId(req);
  const { productIds } = req.body; // array of catalog product IDs
  if (!Array.isArray(productIds) || productIds.length === 0) {
    res.status(400).json({ success: false, error: 'productIds array required' }); return;
  }
  const catalogRows = await query<{ id: string }>(
    `SELECT id FROM mart_products
      WHERE id = ANY($1::uuid[]) AND is_catalog = true AND is_bundle = false`,
    [productIds]
  );
  if (catalogRows.rows.length !== new Set(productIds).size) {
    throw badRequest('Only master catalog products can be added to a store');
  }
  const zoneRows = await query<{ primary_store_id: string }>(
    `SELECT z.primary_store_id
       FROM mart_zone_stores zs
       JOIN mart_zones z ON z.id = zs.zone_id
      WHERE zs.store_id = $1 AND z.is_active = true
      ORDER BY z.primary_store_id ASC
      LIMIT 1`,
    [storeId]
  );
  const headStoreId = zoneRows.rows[0]?.primary_store_id || null;

  const conflicts: Array<{ productId: string; storeId: string; storeName: string }> = [];
  const seenConflicts = new Set<string>();
  for (const productId of productIds) {
    let conflict: { store_id: string; name: string } | undefined;
    if (headStoreId) {
      const conflictRows = await query<{ store_id: string; name: string }>(
        `SELECT sp.store_id, s.name
           FROM mart_store_products sp
           JOIN mart_stores s ON s.id = sp.store_id
           JOIN mart_zone_stores zs ON zs.store_id = sp.store_id
           JOIN mart_zones z ON z.id = zs.zone_id
          WHERE sp.product_id = $1
            AND sp.store_id <> $2
            AND z.primary_store_id = $3
            AND z.is_active = true
          ORDER BY sp.store_id ASC
          LIMIT 1`,
        [productId, storeId, headStoreId]
      );
      conflict = conflictRows.rows[0];
    }
    if (conflict && !seenConflicts.has(productId)) {
      seenConflicts.add(productId);
      conflicts.push({ productId, storeId: conflict.store_id, storeName: conflict.name });
    }
  }

  if (conflicts.length) {
    res.status(409).json({ success: false, error: 'PRODUCT_ALREADY_ADDED_IN_ZONE', conflicts });
    return;
  }

  for (const productId of productIds) {
    await query(
      `INSERT INTO mart_store_products (store_id, product_id, price, unit, discount_percent, availability_status, is_available)
       VALUES ($1, $2, 0, '1 kg', 0, 'hidden', false)
       ON CONFLICT (store_id, product_id) DO NOTHING`,
      [storeId, productId]
    );
  }
  const products = await query<{ id: string; productCode: string }>(
    `SELECT p.id, p.product_code as "productCode"
       FROM mart_products p
       JOIN mart_store_products sp ON sp.product_id = p.id
      WHERE sp.store_id = $1 AND p.id = ANY($2::uuid[])
      ORDER BY p.name ASC`,
    [storeId, productIds]
  );
  res.json({ success: true, data: { added: productIds.length, conflicts, products: products.rows }, message: `${productIds.length} product(s) added to store. Set price and availability to make them live.` });
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
  const { status, deliveryPreference, phone, q, limit, offset } = req.query;
  const isSuperAdmin = req.admin!.role === 'super_admin';
  const isHeadStoreViewer = !isSuperAdmin && await isHeadStore(req.admin!.storeId);
  const canManageMaster = isSuperAdmin || isHeadStoreViewer;
  const storeId = isSuperAdmin ? resolveStoreId(req) : undefined;
  const orders = await OrderService.findAll({
    storeId,
    status: status as string,
    deliveryPreference: deliveryPreference as string,
    phone: phone as string,
    search: typeof q === 'string' ? q : undefined,
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0,
    // Non-super admins see the whole order only when their store is the head
    // store. Member stores get just the lines they fulfil plus their own
    // fulfilment status.
    viewerStoreId: isSuperAdmin ? null : req.admin!.storeId,
    restrictItems: !canManageMaster,
  });
  res.json({
    success: true,
    data: orders.map(order => ({ ...order, canManageMaster })),
  });
});

export const adminLookupRestorableOrder = asyncHandler(async (req: AdminRequest, res: Response) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
  if (!phone.trim()) {
    res.status(400).json({ success: false, error: 'Phone number is required' });
    return;
  }
  const data = await OrderRestoreService.lookup(phone);
  res.json({ success: true, data });
});

export const adminRestoreOrder = asyncHandler(async (req: AdminRequest, res: Response) => {
  const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
  const cartId = typeof req.body?.cartId === 'string' ? req.body.cartId : '';
  const statusRaw = req.body?.status;
  const status = typeof statusRaw === 'string' && (RESTORE_STATUSES as readonly string[]).includes(statusRaw)
    ? statusRaw as RestoreStatus
    : null;
  if (!status) {
    res.status(400).json({ success: false, error: 'Choose a valid order status' });
    return;
  }
  const paymentRaw = req.body?.paymentMethod;
  const paymentMethod = paymentRaw === undefined || paymentRaw === null || paymentRaw === ''
    ? undefined
    : paymentRaw === 'cod' || paymentRaw === 'upi' || paymentRaw === 'phonepay'
      ? paymentRaw as RestorePaymentMethod
      : null;
  if (paymentMethod === null) {
    res.status(400).json({ success: false, error: 'Choose a valid payment method' });
    return;
  }
  const deliveryChargeRaw = req.body?.deliveryCharge;
  const deliveryCharge = deliveryChargeRaw === undefined || deliveryChargeRaw === null || deliveryChargeRaw === ''
    ? undefined
    : Number(deliveryChargeRaw);
  if (deliveryCharge !== undefined && (!Number.isFinite(deliveryCharge) || deliveryCharge < 0)) {
    res.status(400).json({ success: false, error: 'Delivery charge must be zero or more' });
    return;
  }

  const result = await OrderRestoreService.restore({
    phone,
    cartId,
    status,
    orderNumber: typeof req.body?.orderNumber === 'string' && req.body.orderNumber.trim()
      ? req.body.orderNumber.trim()
      : undefined,
    storeId: typeof req.body?.storeId === 'string' && req.body.storeId ? req.body.storeId : undefined,
    deliveryCharge,
    paymentMethod: paymentMethod || undefined,
    guestName: typeof req.body?.guestName === 'string' ? req.body.guestName : undefined,
    guestAddress: typeof req.body?.guestAddress === 'string' ? req.body.guestAddress : undefined,
    notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
  }, {
    id: req.admin!.id,
    username: req.admin!.username,
    role: req.admin!.role,
    storeId: req.admin!.storeId,
  });

  emitOrderEvent({
    type: 'order.created',
    order: {
      id: result.orderId,
      orderNumber: result.orderNumber,
      status: result.status,
      total: result.total,
      storeId: result.storeId,
    },
  });

  res.status(201).json({ success: true, data: result });
});

// KPI summary for the hub Dashboard + Analytics cards. Computed live from the
// orders table (never from stored customer counters), scoped to a range and,
// for non-super admins, to the caller's store.
export const adminGetAnalyticsSummary = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { range, from, to, dateBasis } = req.query;
  const allowed = range === 'today' || range === '7d' || range === '30d' || range === 'last_month' || range === 'custom' || range === 'all';
  if (range === 'custom' && (typeof from !== 'string' || typeof to !== 'string')) {
    res.status(400).json({ success: false, error: 'Custom range requires from and to dates' });
    return;
  }
  // resolveStoreId keeps this scoped like every other admin route: non-super
  // admins are pinned to their own store regardless of the query param, and
  // super admins may target a store explicitly (defaulting to Shapoorji).
  const storeId = resolveStoreId(req);
  const summary = await OrderService.getSummary(
    allowed ? (range as string) : 'all',
    typeof from === 'string' ? from : undefined,
    typeof to === 'string' ? to : undefined,
    storeId,
    { dateBasis: dateBasis === 'browse' ? 'browse' : 'created' }
  );
  res.json({ success: true, data: summary });
});

// Per-customer figures for the Analytics Customers tab (total/repeat/top by
// spend) — computed live from delivered orders, so stored counters that never
// get reversed on cancellation can't mislead the cards.
export const adminGetCustomerAggregates = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { range, from, to, top, dateBasis } = req.query;
  const allowed = range === 'today' || range === '7d' || range === '30d' || range === 'last_month' || range === 'custom' || range === 'all';
  if (range === 'custom' && (typeof from !== 'string' || typeof to !== 'string')) {
    res.status(400).json({ success: false, error: 'Custom range requires from and to dates' });
    return;
  }
  const storeId = resolveStoreId(req);
  const data = await OrderService.getCustomerAggregates(
    allowed ? (range as string) : 'all',
    typeof from === 'string' ? from : undefined,
    typeof to === 'string' ? to : undefined,
    storeId,
    top && !Number.isNaN(parseInt(top as string)) ? Math.min(parseInt(top as string), 100) : 10,
    { dateBasis: dateBasis === 'browse' ? 'browse' : 'created' }
  );
  res.json({ success: true, data });
});

// ── Daily sales ledger (hub → "Daily Sales" page) ────────────────────────────
// App-side figures come live from mart_orders. Offline counter sales are
// itemised rows in mart_offline_sales (one per product sold), so the day's
// cash/UPI split is a SUM over the rows staff actually entered.

export const adminGetDailySalesDay = asyncHandler(async (req: AdminRequest, res: Response) => {
  await assertDailySalesAccess(req);
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    return;
  }
  const storeId = await resolveManagedStoreId(req);
  const day = await DailySalesService.getDay(date, storeId);
  if (req.admin!.role === 'super_admin') {
    res.json({ success: true, data: day });
    return;
  }
  const { couponDeduction: _couponDeduction, ...storeDay } = day;
  res.json({ success: true, data: storeDay });
});

// Filtered ledger: ?mode=today|yesterday|month|all|custom with from/to for custom.
export const adminGetDailySales = asyncHandler(async (req: AdminRequest, res: Response) => {
  await assertDailySalesAccess(req);
  const storeId = await resolveManagedStoreId(req);
  const mode = req.query.mode;
  // IST today/yesterday, matching the dashboard's local-day semantics.
  const istToday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = fmt(istToday);
  let from = today;
  let to = today;
  if (mode === 'today') {
    from = to = today;
  } else if (mode === 'yesterday') {
    from = to = fmt(new Date(istToday.getTime() - 86_400_000));
  } else if (mode === 'month') {
    from = `${today.slice(0, 8)}01`;
  } else if (mode === 'all') {
    from = '1970-01-01';
    to = today; // a future day has no sales yet; nothing to read
  } else if (mode === 'custom') {
    from = typeof req.query.from === 'string' ? req.query.from : today;
    to = typeof req.query.to === 'string' ? req.query.to : today;
  } else {
    res.status(400).json({ success: false, error: 'mode must be today, yesterday, month, all or custom' });
    return;
  }
  const days = await DailySalesService.getDays(from, to, storeId);
  if (req.admin!.role === 'super_admin') {
    res.json({ success: true, data: days });
    return;
  }
  res.json({
    success: true,
    data: days.map(({ couponDeduction: _couponDeduction, ...storeDay }) => storeDay),
  });
});

// Offline counter rows for one day.
export const adminListOfflineSales = asyncHandler(async (req: AdminRequest, res: Response) => {
  await assertDailySalesAccess(req);
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    return;
  }
  const storeId = await resolveManagedStoreId(req);
  const entries = await DailySalesService.listEntries(date, storeId);
  res.json({ success: true, data: entries });
});

// Record one offline item sold: a store product plus quantity, or a manual
// "Other" amount when staff cannot identify the item.
export const adminAddOfflineSale = asyncHandler(async (req: AdminRequest, res: Response) => {
  await assertDailySalesAccess(req);
  const storeId = await resolveManagedStoreId(req);
  const date = typeof req.body?.date === 'string' ? req.body.date : '';
  const productId = typeof req.body?.productId === 'string' ? req.body.productId : '';
  const quantity = Number(req.body?.quantity);
  const amount = Number(req.body?.amount);
  const paymentMethod = req.body?.paymentMethod;
  const notes = typeof req.body?.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim() : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    res.status(400).json({ success: false, error: 'quantity must be greater than 0' });
    return;
  }
  if (paymentMethod !== 'cash' && paymentMethod !== 'upi') {
    res.status(400).json({ success: false, error: 'paymentMethod must be cash or upi' });
    return;
  }
  if (!productId && (!Number.isFinite(amount) || amount <= 0)) {
    res.status(400).json({ success: false, error: 'amount must be greater than 0 for Other sales' });
    return;
  }
  const result = await DailySalesService.addEntry(
    storeId, date, productId || null, quantity, paymentMethod, notes, req.admin?.id ?? null,
    productId ? undefined : amount,
  );
  res.status(201).json({ success: true, data: result });
});

export const adminUpdateOfflineSale = asyncHandler(async (req: AdminRequest, res: Response) => {
  await assertDailySalesAccess(req);
  const storeId = await resolveManagedStoreId(req);
  const date = typeof req.body?.date === 'string' ? req.body.date : '';
  const productId = typeof req.body?.productId === 'string' ? req.body.productId : '';
  const quantity = Number(req.body?.quantity);
  const amount = Number(req.body?.amount);
  const paymentMethod = req.body?.paymentMethod;
  const notes = typeof req.body?.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim() : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    res.status(400).json({ success: false, error: 'quantity must be greater than 0' });
    return;
  }
  if (paymentMethod !== 'cash' && paymentMethod !== 'upi') {
    res.status(400).json({ success: false, error: 'paymentMethod must be cash or upi' });
    return;
  }
  if (!productId && (!Number.isFinite(amount) || amount <= 0)) {
    res.status(400).json({ success: false, error: 'amount must be greater than 0 for Other sales' });
    return;
  }
  const result = await DailySalesService.updateEntry(
    req.params.id, storeId, date, productId || null, quantity, paymentMethod, notes,
    productId ? undefined : amount,
  );
  res.json({ success: true, data: result });
});

export const adminDeleteOfflineSale = asyncHandler(async (req: AdminRequest, res: Response) => {
  await assertDailySalesAccess(req);
  const storeId = await resolveManagedStoreId(req);
  await DailySalesService.removeEntry(req.params.id, storeId);
  res.json({ success: true, data: { removed: true } });
});

// Live order stream (SSE) for the hub. Open hub tabs keep this connection and
// get bomb order events instantly, independent of web-push (whose delivery the
// browser/push-service controls and which lags on weak networks). Scoped to the
// caller's store; super admins (no storeId) receive events for every store.
export const adminOrderStream = asyncHandler(async (req: AdminRequest, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');

  const storeId = req.admin?.storeId || null;
  const listener = (event: OrderLiveEvent) => {
    const order = event.order;
    if (storeId) {
      const isHeadStore = order.storeId === storeId;
      const isFulfillingStore = Array.isArray(order.storeIds) && order.storeIds.includes(storeId);
      if (!isHeadStore && !isFulfillingStore) return;
    }
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client gone; close path below handles cleanup */
    }
  };
  orderEventBus.on('order', listener);
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);
  // The stream is registered so a shutdown can end it. An event stream never
  // finishes on its own, so while one is open the HTTP server cannot finish
  // closing — see utils/sse.ts.
  const untrack = trackStream(res);
  const close = () => {
    orderEventBus.off('order', listener);
    clearInterval(heartbeat);
    untrack();
  };
  res.on('close', close);
  req.on('close', close);
});

// ── Customer push messages ─────────────────────────────────────────────

// ── Customer push messages ─────────────────────────────────────────────
// Customers get exactly three notifications on a successful order:
// confirmed → rider on the way → delivered. The delivery-stage message is
// shared by the single-action "Start Delivery" and by batch dispatch so both
// paths push the same text.
function deliveryEtaLabel(preference?: string | null): string {
  if (preference === 'within_30') return '30 mins';
  if (preference === 'within_60') return '1 hour';
  return '10-15 mins';
}

function riderOnTheWayBody(orderNumber: string, riderName: string | null | undefined, preference?: string | null): string {
  const rider = riderName ? `${riderName} is on the way with your order` : 'The rider is on the way with your order';
  return `🛵 ${rider}. Should reach you within ${deliveryEtaLabel(preference)}.`;
}

// ── Batch dispatch ────────────────────────────────────────────────────
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
    // Notify each customer — same delivery-stage message as single dispatch
    const custResult = await query<{ customer_id: string | null; delivery_preference: string; order_number: string; store_id: string | null }>(
      `SELECT customer_id, delivery_preference, order_number, store_id FROM mart_orders WHERE id = $1`, [orderIds[i]]
    );
    const { delivery_preference, order_number, store_id } = custResult.rows[0] || {};
    // Recipient resolved server-side: member by customer id, guest by tracking
    // token, so guests get the same dispatch push as signed-in customers.
    PushService.notifyOrderRecipient(orderIds[i], {
      title: `Order #${order_number} update`,
      body: riderOnTheWayBody(order_number, admin?.name || req.admin!.username, delivery_preference),
      url: '/orders',
    }).catch(() => {});
    emitOrderEvent({
      type: 'order.updated',
      order: {
        id: orderIds[i],
        orderNumber: order_number,
        status: 'out_for_delivery',
        storeId: store_id || undefined,
      },
    });
  }
  res.json({ success: true, message: `${orderIds.length} order(s) dispatched`, batchId });
});

export const adminUpdateOrderStatus = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { status, failureReason, cancellationReason, deliveryAssigneeId, paymentMethod, forceReadyPickup } = req.body;
  if (paymentMethod !== undefined && paymentMethod !== 'cash' && paymentMethod !== 'upi') {
    res.status(400).json({ success: false, error: 'Payment method must be Cash or UPI' }); return;
  }
  const order = await OrderService.transitionStatus(req.params.id, status, req.admin!, deliveryAssigneeId, cancellationReason, paymentMethod, forceReadyPickup === true);
  if (status === 'failed_delivery' && failureReason) await query(`UPDATE mart_orders SET failure_reason = $1 WHERE id = $2`, [failureReason, req.params.id]);
  if (status === 'cancelled' && cancellationReason) await query(`UPDATE mart_orders SET cancellation_reason = $1 WHERE id = $2`, [cancellationReason, req.params.id]);

  const details = await query<{ customer_id: string | null; guest_name: string; store_name: string; delivery_by: string | null; delivery_preference: string | null }>(
    `SELECT o.customer_id, o.guest_name, COALESCE(s.name, 'Gokez Mart') as store_name, o.delivery_by, o.delivery_preference
     FROM mart_orders o LEFT JOIN mart_stores s ON s.id = o.store_id WHERE o.id = $1`, [req.params.id]
  );
  const detail = details.rows[0];
  const messages: Record<string, string> = {
    confirmed: `✅ Order #${order.orderNumber} confirmed. We're preparing your order.`,
    out_for_delivery: riderOnTheWayBody(order.orderNumber, order.deliveryByName || null, detail?.delivery_preference),
    delivered: `🎉 Order #${order.orderNumber} delivered. Enjoy your order!`,
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
  if (messages[status]) {
    // Member by customer id, guest by tracking token — same update either way.
    PushService.notifyOrderRecipient(order.id, {
      title: `Order #${order.orderNumber} update`,
      body: messages[status], url: '/orders', tag,
    }).catch(() => {});
  }  if (status === 'failed_delivery') {
    PushService.notifyStoreAdmins(order.storeId, {
      title: `Gokez Mart · Delivery failed · Order #${order.orderNumber}`,
      body: `${detail?.guest_name || 'Customer'} · ${failureReason || 'Delivery failed'}`,
      url: '/orders', tag,
    }).catch(() => {});
  }
  const fulfilmentStores = await query<{ storeId: string }>(
    `SELECT DISTINCT store_id as "storeId"
       FROM mart_order_items
      WHERE order_id = $1 AND store_id IS NOT NULL`,
    [order.id]
  );
  emitOrderEvent({
    type: 'order.updated',
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status,
      storeId: order.storeId,
      storeIds: fulfilmentStores.rows.map(row => row.storeId),
    },
  });
  res.json({ success: true, data: order });
});

// A member store moves its own portion from preparing to ready for pickup. The
// head store may do the same after collecting items on a member's behalf. This
// never changes the master order status, so customer-facing progress stays
// under the head store's control.
export const adminUpdateOrderFulfilment = asyncHandler(async (req: AdminRequest, res: Response) => {
  const status = req.body.status;
  if (status !== 'prepared' && status !== 'delivered') {
    res.status(400).json({ success: false, error: 'status must be prepared or delivered' }); return;
  }
  const fulfilment = await OrderService.updateStoreFulfilment(
    req.params.id,
    req.params.storeId,
    status,
    req.admin!
  );
  const stores = await query<{ storeId: string }>(
    `SELECT DISTINCT store_id as "storeId"
       FROM mart_order_items
      WHERE order_id = $1 AND store_id IS NOT NULL`,
    [req.params.id]
  );
  emitOrderEvent({
    type: 'order.updated',
    order: {
      id: req.params.id,
      orderNumber: fulfilment.orderNumber,
      status: fulfilment.masterStatus,
      storeId: fulfilment.headStoreId,
      storeIds: stores.rows.map(row => row.storeId),
    },
  });
  res.json({ success: true, data: fulfilment });
});

// Correct an order after an item adjustment. The admin picks the quantity that
// actually arrived for each line; the service removes the rest, recalculates the
// order money, returns any stock for an already-delivered order, and writes an
// audit row so the original quantity is never lost.
export const adminAdjustOrderItems = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { adjustments, reason, paymentMethod, additions } = req.body;
  const adjustmentList = Array.isArray(adjustments) ? adjustments : [];
  const additionList = Array.isArray(additions) ? additions : [];
  if (adjustmentList.length === 0 && additionList.length === 0 && paymentMethod === undefined) {
    res.status(400).json({ success: false, error: 'Choose at least one item to adjust or add, or change the payment mode' }); return;
  }
  if (paymentMethod !== undefined && paymentMethod !== 'cod' && paymentMethod !== 'upi') {
    res.status(400).json({ success: false, error: 'Choose a valid payment mode' }); return;
  }
  const normalized = adjustmentList.map((entry: any) => {
    const rawQuantity = entry?.deliveredQuantity;
    const deliveredQuantity = Number(rawQuantity);
    const orderItemId = String(entry?.orderItemId || '');
    const quantityIsValid = (typeof rawQuantity === 'number' || typeof rawQuantity === 'string')
      && Number.isInteger(deliveredQuantity) && deliveredQuantity >= 0;
    if (!orderItemId || !quantityIsValid) {
      throw badRequest('Each adjustment needs a valid order item and delivered quantity');
    }
    return { orderItemId, deliveredQuantity };
  });
  const normalizedAdditions = additionList.map((entry: any) => {
    const quantity = Number(entry?.quantity);
    const productId = String(entry?.productId || '');
    const quantityIsValid = (typeof entry?.quantity === 'number' || typeof entry?.quantity === 'string')
      && Number.isInteger(quantity) && quantity > 0;
    const price = Number(entry?.price);
    const unit = typeof entry?.unit === 'string' ? entry.unit.trim() : '';
    if (!productId || !quantityIsValid || !unit || !Number.isFinite(price) || price < 0) {
      throw badRequest('Each added item needs a product, positive quantity, unit and valid price');
    }
    return { productId, quantity, unit, price };
  });

  const result = await OrderService.adjustItems(
    req.params.id,
    normalized,
    typeof reason === 'string' ? reason.trim() : '',
    req.admin!,
    paymentMethod,
    normalizedAdditions,
  );

  ComplianceService.logAudit({
    adminId: req.admin!.id,
    username: req.admin!.username,
    role: req.admin!.role,
    action: 'order_items_adjusted',
    entityType: 'order',
    entityId: result.id,
    detail: `Order #${result.orderNumber}: ${result.adjustedItems} line(s) adjusted, ₹${result.removedTotal.toFixed(2)} removed, ${result.addedItems} line(s) added, ₹${result.addedTotal.toFixed(2)} added, new total ₹${result.total.toFixed(2)}, payment ${result.paymentMethod}${reason ? ` — ${reason}` : ''}`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  if (result.status === 'delivered' && result.adjustedItems > 0) {
    PushService.notifyOrderRecipient(result.id, {
      title: `Order #${result.orderNumber} updated`,
      body: `An item we could not deliver was removed. Your updated total is ₹${result.total.toFixed(0)}.`,
      url: '/orders',
      tag: `order-${result.id}`,
    }).catch(() => {});
  }

  if (result.addedItems > 0) {
    PushService.notifyOrderRecipient(result.id, {
      title: `Order #${result.orderNumber} updated`,
      body: `An item was added to your order. Your updated total is ₹${result.total.toFixed(0)}.`,
      url: '/orders',
      tag: `order-${result.id}`,
    }).catch(() => {});
  }

  emitOrderEvent({
    type: 'order.updated',
    order: {
      id: result.id,
      orderNumber: result.orderNumber,
      status: result.status,
      storeId: result.storeId,
      total: result.total,
    },
  });

  res.json({ success: true, data: result });
});

export const adminRescheduleOrder = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { scheduledFor } = req.body;
  if (typeof scheduledFor !== 'string') {
    res.status(400).json({ success: false, error: 'Choose a delivery time' }); return;
  }
  const order = await OrderService.rescheduleDelivery(req.params.id, new Date(scheduledFor), req.admin!);
  const schedule = order.scheduledForLabel || 'the requested time';

  ComplianceService.logAudit({
    adminId: req.admin!.id,
    username: req.admin!.username,
    role: req.admin!.role,
    action: 'order_delivery_rescheduled',
    entityType: 'order',
    entityId: order.id,
    detail: `Order #${order.orderNumber} rescheduled for ${schedule}`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });
  PushService.notifyOrderRecipient(order.id, {
    title: `Order #${order.orderNumber} delivery rescheduled`,
    body: `As requested, your delivery has been rescheduled to ${schedule}.`,
    url: '/orders',
    tag: `order-${order.id}`,
  }).catch(() => {});
  emitOrderEvent({
    type: 'order.updated',
    order: { id: order.id, orderNumber: order.orderNumber, status: order.status, storeId: order.storeId },
  });
  res.json({ success: true, data: order });
});


// ── Confirm after-hours order for the next opening hours ────────────────────
// The store was shut when the customer ordered, so instead of "start preparing"
// the hub acknowledges the order for the next opening: same confirmed status,
// plus a promise the customer card shows and a push explaining it.
export const adminConfirmNextOpen = asyncHandler(async (req: AdminRequest, res: Response) => {
  const order = await OrderService.confirmForNextOpen(req.params.id, req.admin!);
  PushService.notifyOrderRecipient(req.params.id, {
    title: `Order #${order.orderNumber} update`,
    body: order.nextOpenLabel
      ? `✅ Order #${order.orderNumber} confirmed — we'll deliver it when the store opens (${order.nextOpenLabel}).`
      : `✅ Order #${order.orderNumber} confirmed — we'll deliver it during the next opening hours.`,
    url: '/orders',
    tag: `order-${req.params.id}`,
  }).catch(() => {});
  emitOrderEvent({
    type: 'order.updated',
    order: {
      id: req.params.id,
      orderNumber: order.orderNumber,
      status: 'confirmed',
      storeId: order.storeId,
    },
  });
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
  PushService.notifyOrderRecipient(req.params.id, { title: `Order #${ord.order_number}`, body: MSGS[reason] || MSGS.other, url: '/orders', tag: `order-${req.params.id}` }).catch(() => {});  emitOrderEvent({
    type: 'order.updated',
    order: {
      id: req.params.id,
      orderNumber: ord.order_number,
      status: 'terminated',
      storeId: ord.store_id || undefined,
    },
  });
  res.json({ success: true, message: 'Order terminated', orderNumber: ord.order_number });
});
// ── Admin customer controllers ────────────────────────────────────────────────

export const adminGetCustomers = asyncHandler(async (req: AdminRequest, res: Response) => {
  const allowedRoles = ['super_admin'];
  if (!req.admin || !allowedRoles.includes(req.admin.role)) {
    res.status(403).json({ success: false, error: 'Access denied' }); return;
  }
  const identity = req.query.identity === 'signed_in' || req.query.identity === 'guest_checkout'
    ? req.query.identity
    : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  // Empty pattern keeps the search clause a no-op while avoiding a null param.
  const searchPattern = search ? `%${search}%` : '';
  // Date range uses the same vocabulary and IST boundaries as the other
  // reports. 'yesterday' is folded into custom by the hub, so it never arrives.
  const range = req.query.range === 'today' || req.query.range === '7d'
    || req.query.range === '30d' || req.query.range === 'last_month'
    || req.query.range === 'custom'
    ? req.query.range
    : 'all';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (range === 'custom' && !isValidReportDateRange(from, to)) {
    res.status(400).json({ success: false, error: 'Choose a valid custom date range' }); return;
  }
  const ranged = range !== 'all';
  // Counts and money come live from the order rows: completed (delivered) and
  // cancelled (any side, any reason, terminated included) are kept apart, and
  // spend only counts delivered orders. Materialised mart_customers counters
  // drift once an order is cancelled or backfilled, so they are not read here.
  const SORTS: Record<string, string> = {
    orders_desc: '"orderCount" DESC, "createdAt" DESC',
    spend_desc: '"totalSpent" DESC, "orderCount" DESC',
    name_asc: 'name ASC NULLS LAST, phone ASC',
    newest: '"createdAt" DESC',
  };
  const sortKey = typeof req.query.sort === 'string' ? req.query.sort : 'orders_desc';
  const orderBy = SORTS[sortKey] || SORTS.orders_desc;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit), 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(String(req.query.offset), 10) || 0, 0);
  const identitySql = `CASE WHEN EXISTS (
    SELECT 1 FROM mart_customer_leads l
    WHERE l.customer_id = c.id AND l.verified_at IS NOT NULL
  ) THEN 'signed_in' ELSE 'guest_checkout' END`;

  // Each query binds its own placeholders, so the window builder is told where
  // its parameters start.
  const listWindow = buildOrderWindow(range, from, to, null, { startIndex: 5, dateBasis: 'browse' });
  const countWindow = buildOrderWindow(range, from, to, null, { startIndex: 4, dateBasis: 'browse' });
  const statsWindow = buildOrderWindow(range, from, to, null, { startIndex: 1, dateBasis: 'browse' });
  const newWindow = buildOrderWindow(range, from, to, null, {
    column: 'fd.first_delivered_at',
    startIndex: 1 + statsWindow.params.length,
  });

  const statsSql = ranged
    ? `WITH window_orders AS (
         SELECT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS phone,
                o.status, o.total
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
         ${statsWindow.where}
       ), first_deliveries AS (
         SELECT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS phone,
                MIN(o.delivered_at) AS first_delivered_at
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
         WHERE o.status = 'delivered'
         GROUP BY 1
       ), activity AS (
         SELECT w.phone,
                COUNT(*) FILTER (WHERE w.status = 'delivered')::int AS delivered_orders,
                COALESCE(SUM(w.total) FILTER (WHERE w.status = 'delivered'), 0)::float AS delivered_revenue
         FROM window_orders w
         WHERE w.phone IS NOT NULL
         GROUP BY w.phone
       )
       SELECT COUNT(*)::int AS "totalCustomers",
              COALESCE(SUM(a.delivered_revenue), 0)::float AS "totalRevenue",
              COALESCE(SUM(a.delivered_orders), 0)::int AS "totalOrders",
              COUNT(*) FILTER (WHERE NOT (${newWindow.clause || 'FALSE'}))::int AS "repeatCustomers",
              COUNT(*) FILTER (WHERE ${newWindow.clause || 'FALSE'})::int AS "newCustomers"
       FROM activity a
       JOIN first_deliveries fd ON fd.phone = a.phone`
    : `WITH phone_orders AS (
         SELECT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS phone,
                o.status, o.total, o.created_at, o.delivered_at
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
       ), first_deliveries AS (
         SELECT phone, MIN(delivered_at) AS first_delivered_at
         FROM phone_orders
         WHERE status = 'delivered' AND phone IS NOT NULL
         GROUP BY phone
       ), customers AS (
         SELECT f.phone, f.first_delivered_at,
                COUNT(*) FILTER (WHERE p.status = 'delivered')::int AS delivered_orders,
                COALESCE(SUM(p.total) FILTER (WHERE p.status = 'delivered'), 0)::float AS delivered_revenue,
                BOOL_OR(p.status NOT IN ('cancelled', 'failed_delivery', 'terminated')
                        AND p.created_at > f.first_delivered_at) AS is_returning
         FROM first_deliveries f
         JOIN phone_orders p ON p.phone = f.phone
         GROUP BY f.phone, f.first_delivered_at
       )
       SELECT COUNT(*)::int AS "totalCustomers",
              COALESCE(SUM(delivered_revenue), 0)::float AS "totalRevenue",
              COALESCE(SUM(delivered_orders), 0)::int AS "totalOrders",
              COUNT(*) FILTER (WHERE is_returning)::int AS "repeatCustomers",
              COUNT(*) FILTER (WHERE NOT is_returning AND first_delivered_at >= now() - interval '30 days')::int AS "newCustomers"
       FROM customers`;

  const [customers, counts, stats] = await Promise.all([
    query(
      `WITH classified AS (
         SELECT c.id, c.phone, c.name, c.address, c.created_at,
                ${identitySql} as "identityType",
                NULLIF(regexp_replace(c.phone, '\\D', '', 'g'), '') AS ckey
         FROM mart_customers c
       ), order_agg AS (
         SELECT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS ckey,
                COUNT(*) FILTER (WHERE o.status = 'delivered')::int AS "completedOrders",
                COUNT(*) FILTER (WHERE o.status IN ('cancelled','failed_delivery','terminated'))::int AS "canceledOrders",
                COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0)::float AS "totalSpent"
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
         ${listWindow.where}
         GROUP BY 1
       )
       SELECT c.id, c.phone, c.name, c.address, c.created_at as "createdAt", c."identityType",
              COALESCE(a."completedOrders", 0)::int AS "completedOrders",
              COALESCE(a."canceledOrders", 0)::int AS "canceledOrders",
              (COALESCE(a."completedOrders", 0) + COALESCE(a."canceledOrders", 0))::int AS "orderCount",
              COALESCE(a."totalSpent", 0)::float AS "totalSpent"
       FROM classified c
       LEFT JOIN order_agg a ON a.ckey = c.ckey
       WHERE ($1 = 'all' OR c."identityType" = $1)
         AND ($4 = '' OR c.name ILIKE $4 OR c.phone ILIKE $4 OR c.address ILIKE $4)
         AND (${ranged ? 'a.ckey IS NOT NULL' : 'TRUE'})
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [identity, limit, offset, searchPattern, ...listWindow.params]
    ),
    query<{ total: number; signedIn: number; guestCheckout: number; filtered: number }>(
      `WITH classified AS (
         SELECT c.name, c.phone, c.address, ${identitySql} as "identityType",
                NULLIF(regexp_replace(c.phone, '\\D', '', 'g'), '') AS ckey
         FROM mart_customers c
       ), active AS (
         SELECT DISTINCT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS ckey
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
         ${countWindow.where}
       )
       SELECT COUNT(*) FILTER (WHERE $3 = 'all' OR a.ckey IS NOT NULL)::int as total,
              COUNT(*) FILTER (WHERE "identityType" = 'signed_in'
                                 AND ($3 = 'all' OR a.ckey IS NOT NULL))::int as "signedIn",
              COUNT(*) FILTER (WHERE "identityType" = 'guest_checkout'
                                 AND ($3 = 'all' OR a.ckey IS NOT NULL))::int as "guestCheckout",
              COUNT(*) FILTER (WHERE ($1 = 'all' OR "identityType" = $1)
                                 AND ($2 = '' OR name ILIKE $2 OR phone ILIKE $2 OR address ILIKE $2)
                                 AND ($3 = 'all' OR a.ckey IS NOT NULL))::int as filtered
       FROM classified c
       LEFT JOIN active a ON a.ckey = c.ckey`,
      [identity, searchPattern, range, ...countWindow.params]
    ),
    query<{ totalCustomers: number; totalRevenue: number; totalOrders: number; repeatCustomers: number; newCustomers: number }>(
      statsSql,
      ranged ? [...statsWindow.params, ...newWindow.params] : []
    ),
  ]);
  const count = counts.rows[0] || { total: 0, signedIn: 0, guestCheckout: 0, filtered: 0 };
  const filteredTotal = count.filtered;
  const customerStats = stats.rows[0] || { totalCustomers: 0, totalRevenue: 0, totalOrders: 0, repeatCustomers: 0, newCustomers: 0 };
  res.json({
    success: true,
    data: customers.rows,
    counts: { total: count.total, signedIn: count.signedIn, guestCheckout: count.guestCheckout },
    stats: {
      ...customerStats,
      avgOrders: customerStats.totalCustomers > 0
        ? Math.round((customerStats.totalOrders / customerStats.totalCustomers) * 10) / 10
        : 0,
    },
    pagination: { limit, offset, total: filteredTotal, hasMore: offset + customers.rows.length < filteredTotal },
  });
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
  const [summary, analytics] = await Promise.all([
    FunnelService.getExtended(range as FunnelRange, from, to),
    CustomerAnalyticsService.getReport(range as FunnelRange, from, to),
  ]);
  res.json({ success: true, data: { ...summary, analytics } });
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
  // A manual closure has to say when it lifts, so the customer can be told
  // rather than left with a store that is simply shut.
  //
  // The check is on the MERGED result, not on the body: clearing the closure
  // sends only the switch, and the times stay as they were, so looking at the
  // body alone would read as a closure with no times.
  const current = await SettingsService.getPublic(storeId);
  const merged: Record<string, string | undefined> = { ...current, ...req.body };
  if (merged.store_open === 'false') {
    if (!merged.store_closed_from || !merged.store_closed_until) {
      res.status(400).json({
        success: false,
        error: 'A manual closure needs both a start time and a reopen time, so customers know when the store is back.',
      });
      return;
    }
    if (!parseIstLocalDateTime(merged.store_closed_from) || !parseIstLocalDateTime(merged.store_closed_until)) {
      res.status(400).json({ success: false, error: 'The closure times are not valid.' });
      return;
    }
  }
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

/** Replace the tagged stores of a zone. Body: { storeIds: string[] } */
export const adminZoneTagStores = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeIds = Array.isArray(req.body?.storeIds) ? req.body.storeIds : [];
  const zone = await ZoneService.tagStores(req.params.id, storeIds);
  if (!zone) { res.status(404).json({ success: false, error: 'Zone not found' }); return; }
  res.json({ success: true, data: zone });
});

/** Set the zone head (primary store). Body: { storeId } */
export const adminZoneSetPrimary = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = req.body?.storeId;
  if (typeof storeId !== 'string' || !storeId) {
    res.status(400).json({ success: false, error: 'storeId is required' }); return;
  }
  const zone = await ZoneService.setPrimaryStore(req.params.id, storeId);
  if (!zone) { res.status(404).json({ success: false, error: 'Zone not found' }); return; }
  res.json({ success: true, data: zone });
});

/** Read the zone-scoped open/close settings. */
export const adminGetZoneSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const settings = await ZoneService.getSettings(req.params.id);
  res.json({ success: true, data: settings });
});

/** Write zone-scoped open/close settings. Body: a subset of ZONE_SETTING_KEYS. */
export const adminUpdateZoneSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const values = typeof req.body === 'object' && req.body ? req.body : {};
  await ZoneService.updateSettings(req.params.id, values);
  res.json({ success: true, message: 'Zone settings updated' });
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
  await StoreSubscriptionService.createPending(store.id, store.monthlyFee, req.admin!.id);
  res.status(201).json({ success: true, data: store });
});

export const adminUpdateStore = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (req.body.isLive === true && !(await StoreSubscriptionService.isActive(req.params.id))) {
    res.status(400).json({ success: false, error: 'Activate the store subscription before taking the store live' }); return;
  }
  const store = await StoreService.update(req.params.id, req.body);
  if (!store) { res.status(404).json({ success: false, error: 'Store not found' }); return; }
  res.json({ success: true, data: store });
});

export const adminGetStoreSubscriptions = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const subscriptions = await StoreSubscriptionService.findAll();
  res.json({ success: true, data: subscriptions });
});

export const adminUpdateStoreSubscription = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { planName, amount, status, startsAt, endsAt, paymentReference, notes } = req.body;
  const validStatuses: StoreSubscriptionStatus[] = ['pending', 'active', 'suspended', 'expired', 'cancelled'];
  if (typeof planName !== 'string' || !planName.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0 || !validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: 'Plan name, non-negative amount and valid status are required' }); return;
  }
  const subscription = await StoreSubscriptionService.save(req.params.id, {
    planName, amount: Number(amount), status, startsAt: startsAt || null, endsAt: endsAt || null, paymentReference, notes,
  }, req.admin!.id);
  res.json({ success: true, data: subscription });
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
  const { storeName, ownerName, phone, area, message, productCategories, gstStatus, gstin,
    fssaiStatus, fssaiNumber, localPermissionStatus, agreementAccepted, complianceDeclarationAccepted } = req.body;
  if (!storeName?.trim() || !ownerName?.trim() || !phone?.trim() || !area?.trim()) {
    res.status(400).json({ success: false, error: 'storeName, ownerName, phone and area are required' }); return;
  }
  if (!Array.isArray(productCategories) || productCategories.length === 0 || !agreementAccepted || !complianceDeclarationAccepted) {
    res.status(400).json({ success: false, error: 'Product category, agreement acceptance and compliance declaration are required' }); return;
  }
  if (!['registered', 'not_registered', 'not_applicable', 'unknown'].includes(gstStatus) ||
      !['registered', 'not_registered', 'not_applicable', 'unknown'].includes(fssaiStatus) ||
      !['available', 'not_available', 'not_applicable', 'unknown'].includes(localPermissionStatus)) {
    res.status(400).json({ success: false, error: 'Invalid compliance status' }); return;
  }
  const app = await StoreService.createApplication({ storeName, ownerName, phone, area, message,
    productCategories, gstStatus, gstin, fssaiStatus, fssaiNumber, localPermissionStatus });
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
  const { phone, otp, funnelSessionId, trackingTokens } = req.body;
  if (!phone || !otp) { res.status(400).json({ success: false, error: 'Phone and OTP required' }); return; }
  const result = await CustomerAuthService.verifyOtp(phone, otp);
  // Attribution link only. Auth behaviour is unchanged and a missing or invalid
  // session id is ignored rather than surfaced, so a tracking failure can never
  // affect whether a customer logs in. The phone is not stored here; the
  // customer id was already resolved server-side by the call above.
  if (funnelSessionId && result?.customer?.id) {
    await FunnelEventService.linkSessionToCustomer(funnelSessionId, result.customer.id).catch(() => undefined);
  }
  // Move this device's guest push subscriptions onto the now-known customer id,
  // so a device that ordered as a guest then logged in gets one push per order,
  // not a member push and a guest push. Best-effort: never block login. Only the
  // tokens the client actually holds are accepted, and only rows still owned by
  // a guest (tracking_token set) are moved.
  if (result?.customer?.id && Array.isArray(trackingTokens)) {
    const tokens = trackingTokens.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 20);
    if (tokens.length) {
      await PushService.rekeyGuestSubscriptions(result.customer.id, tokens).catch(() => undefined);
    }
  }
  res.json({ success: true, data: result });
});

export const postFunnelEvent = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, visitorId, eventName, path, props, channel, referrer, utmSource, utmMedium, utmCampaign,
    source, medium, content, term, qrCodeId, platform, deviceCategory, browser, isPwa } = req.body ?? {};
  if (!sessionId || !eventName) {
    res.status(400).json({ success: false, error: 'sessionId and eventName required' });
    return;
  }
  const recorded = await FunnelEventService.recordEvent({
    sessionId, visitorId, eventName, path, props, channel, referrer, utmSource, utmMedium, utmCampaign,
    source, medium, content, term, qrCodeId, platform, deviceCategory, browser, isPwa,
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

export const postInstallEvent = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, visitorId, platform, eventName } = req.body ?? {};
  if (!sessionId || !platform || !eventName) {
    res.status(400).json({ success: false, error: 'sessionId, platform and eventName required' });
    return;
  }
  const recorded = await InstallAnalyticsService.recordEvent({ sessionId, visitorId, platform, eventName });
  if (!recorded) { res.status(400).json({ success: false, error: 'Invalid platform or eventName' }); return; }
  res.json({ success: true, data: { recorded } });
});

export const adminGetInstallAnalytics = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const summary = await InstallAnalyticsService.getSummary(from, to);
  res.json({ success: true, data: summary });
});

export const customerGetMe = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const customer = await CustomerAuthService.getCustomer(req.customer!.id);
  if (!customer) { res.status(404).json({ success: false, error: 'Customer not found' }); return; }
  res.json({ success: true, data: customer });
});

export const customerUpdateProfile = asyncHandler(async (req: CustomerRequest, res: Response) => {
  if (req.body.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)) {
      res.status(400).json({ success: false, error: 'Enter a valid name' });
      return;
    }
    req.body.name = name;
  }
  const customer = await CustomerAuthService.updateProfile(req.customer!.id, req.body);
  res.json({ success: true, data: customer });
});

// ── Customer address book ─────────────────────────────────────────────────────

/**
 * Public guest save. A guest (no session) keeps their name/phone/address up to
 * date on the customer row created when a previous order landed, so the hub
 * shows the address they last used rather than the one frozen into their first
 * order. Only an unverified phone is touched — see CustomerAuthService for why.
 */
export const saveGuestDetails = asyncHandler(async (req: Request, res: Response) => {
  const phone = normalizeCustomerPhone(req.body.phone);
  if (!isValidCustomerPhone(phone)) { res.status(400).json({ success: false, error: 'Enter a valid 10-digit mobile number' }); return; }
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';
  if (address.length < 10 || address.length > 500) { res.status(400).json({ success: false, error: 'Enter a complete delivery address' }); return; }
  const name = typeof req.body.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
  if (name && (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name))) {
    res.status(400).json({ success: false, error: 'Enter a valid name' }); return;
  }
  const { label, latitude, longitude } = req.body;
  if (!hasValidCoordinates(latitude, longitude)) { res.status(400).json({ success: false, error: 'Invalid address coordinates' }); return; }
  await CustomerAuthService.saveGuestDetails(phone, { name, address, label, latitude, longitude });
  res.json({ success: true });
});

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
  const reason = typeof (req.body?.reason ?? req.query.reason) === 'string'
    ? String(req.body?.reason ?? req.query.reason).trim()
    : null;
  let order;
  try {
    order = await OrderService.cancelByCaller(req.params.id, scope, reason);
  } catch (err: any) {
    const status = err?.status === 404 || err?.status === 400 ? err.status : 500;
    res.status(status).json({ success: false, error: err?.message || 'Could not cancel the order' });
    return;
  }

  if (order.storeId) {
    PushService.notifyStoreAdmins(order.storeId, {
      title: `Order #${order.orderNumber} cancelled`,
      body: order.cancellationCustomerMessage || `${order.guestName || 'Customer'} cancelled the order.`,
      url: '/orders',
      tag: `order-${req.params.id}`,
    }).catch(() => {});
  }
  emitOrderEvent({
    type: 'order.updated',
    order: {
      id: req.params.id,
      orderNumber: order.orderNumber,
      status: 'cancelled',
      storeId: order.storeId || undefined,
    },
  });
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

async function runCancellationRequest(req: CustomerRequest, res: Response, scope: CancelScope) {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
  let order;
  try {
    order = await OrderService.requestCancellationByCaller(req.params.id, scope, reason);
  } catch (err: any) {
    const status = err?.status === 404 || err?.status === 400 ? err.status : 500;
    res.status(status).json({ success: false, error: err?.message || 'Could not request cancellation' });
    return;
  }
  if (order.storeId) {
    PushService.notifyStoreAdmins(order.storeId, {
      title: `Cancellation requested · #${order.orderNumber}`,
      body: `${order.guestName || 'Customer'} requested cancellation: ${CUSTOMER_CANCELLATION_MESSAGES[reason as CustomerCancelReason] || reason}.`,
      url: '/orders',
      tag: `order-${req.params.id}`,
    }).catch(() => {});
  }
  res.json({ success: true, message: 'Cancellation requested' });
}

export const customerRequestCancellation = asyncHandler(async (req: CustomerRequest, res: Response) => {
  if (!req.customer) { res.status(401).json({ success: false, error: 'Not signed in' }); return; }
  await runCancellationRequest(req, res, { customerId: req.customer.id });
});

export const guestRequestCancellation = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const token = typeof req.body?.trackingToken === 'string' ? req.body.trackingToken.trim() : '';
  if (!token) { res.status(400).json({ success: false, error: 'A tracking token is required' }); return; }
  await runCancellationRequest(req, res, { trackingToken: token });
});

export const adminDeclineCancellationRequest = asyncHandler(async (req: AdminRequest, res: Response) => {
  const order = await OrderService.declineCancellationRequest(req.params.id, req.admin!);
  PushService.notifyOrderRecipient(req.params.id, {
    title: `Order #${order.orderNumber} update`,
    body: 'The store cannot cancel this order because preparation is already underway.',
    url: '/orders',
  }).catch(() => {});
  res.json({ success: true, message: 'Cancellation request declined' });
});

// ── Admin user management (super_admin only) ─────────────────────────────────

export const adminGetUsers = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const result = await query(
    `SELECT a.id, a.username, a.name, a.email, a.phone, a.role,
            a.store_id as "storeId",
            s.name as "storeName",
            z.id as "zoneId",
            z.name as "zoneName",
            z.primary_store_id as "zoneHeadStoreId",
            (z.primary_store_id = a.store_id) as "isZoneHead",
            (EXISTS (SELECT 1 FROM mart_zone_stores zs WHERE zs.zone_id = z.id AND zs.store_id = a.store_id)) as "isZoneMember",
            a.is_active as "isActive",
            a.last_login_at as "lastLoginAt",
            a.created_at as "createdAt"
     FROM mart_admins a
     LEFT JOIN mart_stores s ON s.id = a.store_id
     LEFT JOIN mart_zones z ON z.id = (
       SELECT mz.id FROM mart_zones mz
       WHERE mz.primary_store_id = a.store_id
          OR mz.store_id = a.store_id
          OR EXISTS (
            SELECT 1 FROM mart_zone_stores mzs
            WHERE mzs.zone_id = mz.id AND mzs.store_id = a.store_id
          )
       LIMIT 1
     )
     ORDER BY a.role ASC, a.name ASC`
  );
  res.json({ success: true, data: result.rows });
});

export const adminCreateUser = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { username, password, name, email, phone, role, storeId } = req.body;
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (!username?.trim() || !password || !role) {
    res.status(400).json({ success: false, error: 'username, password and role are required' }); return;
  }
  if (normalizedPhone && !/^[6-9]\d{9}$/.test(normalizedPhone)) {
    res.status(400).json({ success: false, error: 'Phone must be a valid 10-digit mobile number' }); return;
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
  // Writing only mart_admins.store_id left the user without a store assignment,
  // so the Team screen and the order-assignment dropdown (both read assignments)
  // never listed them. Create the assignment in the same transaction.
  const user = await transaction(async client => {
    const result = await client.query(
      `INSERT INTO mart_admins (id, username, password_hash, name, email, phone, role, store_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, name, email, phone, role, store_id as "storeId", created_at as "createdAt"`,
      [username.trim(), hash, name?.trim() || null, email?.trim() || null,
        normalizedPhone || null, role, role === 'super_admin' ? null : storeId]
    );
    const created = result.rows[0];
    if (role !== 'super_admin') {
      await client.query(
        `INSERT INTO mart_admin_store_assignments (admin_id, store_id, role, assigned_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (admin_id, store_id) DO UPDATE SET
           role = EXCLUDED.role, is_active = true, assigned_by = EXCLUDED.assigned_by, updated_at = NOW()`,
        [created.id, storeId, role, req.admin!.id]
      );
    }
    return created;
  });
  res.status(201).json({ success: true, data: user });
});

export const adminUpdateUser = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { name, email, phone, role, storeId, password, isActive } = req.body;
  const { id } = req.params;
  const normalizedPhone = phone === undefined ? undefined : String(phone || '').replace(/\D/g, '');
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
  if (normalizedPhone && !/^[6-9]\d{9}$/.test(normalizedPhone)) {
    res.status(400).json({ success: false, error: 'Phone must be a valid 10-digit mobile number' }); return;
  }
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (name !== undefined)     { fields.push(`name = $${i++}`);      params.push(name?.trim() || null); }
  if (email !== undefined)    { fields.push(`email = $${i++}`);     params.push(email?.trim() || null); }
  if (phone !== undefined)    { fields.push(`phone = $${i++}`);     params.push(normalizedPhone || null); }
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
  // The user row and its primary-store assignment must move together: a failure
  // after the UPDATE used to leave the account changed but the API reporting 500.
  const updated = await transaction(async client => {
    const result = await client.query(
      `UPDATE mart_admins SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, username, name, email, phone, role, store_id as "storeId", is_active as "isActive"`,
      params
    );
    const row = result.rows[0];
    if (!row) return null;
    // Keep the primary-store assignment in step with a role/store edit. Editing a
    // user used to change mart_admins only, so a user promoted to delivery_staff
    // (or moved to another store) stayed absent from the assignment-driven
    // Team screen and order-assignment dropdown.
    if (role !== undefined || storeId !== undefined) {
      if (row.role === 'super_admin') {
        await client.query(
          `UPDATE mart_admin_store_assignments SET is_active = false, updated_at = NOW()
           WHERE admin_id = $1 AND is_active = true`,
          [id]
        );
      } else if (row.storeId) {
        await client.query(
          `INSERT INTO mart_admin_store_assignments (admin_id, store_id, role, assigned_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (admin_id, store_id) DO UPDATE SET
             role = EXCLUDED.role, updated_at = NOW()`,
          [id, row.storeId, row.role, req.admin!.id]
        );
      }
    }
    return row;
  });
  if (!updated) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, data: updated });
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

/**
 * Guest push subscription. No session — the credential is the per-order
 * tracking token the device already holds. We verify the token maps to a real
 * order before storing, so a junk token cannot occupy the UNIQUE(endpoint) row
 * a real device would later need. Returns the same 404 shape as an unknown
 * order so tokens cannot be probed for existence.
 */
export const guestSavePushSub = asyncHandler(async (req: Request, res: Response) => {
  const { endpoint, keys, trackingToken } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth || !trackingToken || typeof trackingToken !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid subscription' }); return;
  }
  const found = await query<{ id: string }>(
    `SELECT id FROM mart_orders WHERE tracking_token = $1 LIMIT 1`,
    [trackingToken.trim()]
  );
  if (!found.rows.length) {
    res.status(404).json({ success: false, error: 'Order not found' }); return;
  }
  await PushService.saveGuestSubscription(trackingToken.trim(), { endpoint, keys });
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
  const image = await prepareAvatarImage(req.file.buffer);
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
    signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
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

// ── Product suggestions ("Suggest products") ──────────────────────────────────

export const submitProductSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const { suggestedProduct, detail, zoneId, zoneName, storeId, storeName, contactConsent } = req.body;
  const product = typeof suggestedProduct === 'string' ? suggestedProduct.trim() : '';
  if (!product) { res.status(400).json({ success: false, error: 'Please tell us what you would like us to stock.' }); return; }
  if (product.length > 200) { res.status(400).json({ success: false, error: 'Keep the suggestion under 200 characters.' }); return; }

  // Guests and signed-in customers both reach this route. authenticateCustomerIfPresent
  // fills req.customer when a token is present, so identity is optional.
  const customer = (req as CustomerRequest).customer;
  let phone = customer?.phone || null;
  let name: string | null = null;

  if (customer) {
    const cust = (await query<{ name: string | null; phone: string | null }>(
      `SELECT name, phone FROM mart_customers WHERE id = $1`, [customer.id]
    )).rows[0];
    if (cust) { phone = cust.phone || phone; name = cust.name; }
  }

  // Prefer the DB store record over whatever the client sent, so a spoofed or
  // stale storeId can't attribute demand to the wrong store.
  let resolvedStoreName = storeName || null;
  if (storeId) {
    const store = (await query<{ name: string }>(`SELECT name FROM mart_stores WHERE id = $1`, [storeId])).rows[0];
    if (store) resolvedStoreName = store.name;
  }

  const suggestion = await ProductSuggestionService.create({
    customerId: customer?.id || null,
    phone,
    name,
    suggestedProduct: product,
    detail: typeof detail === 'string' && detail.trim() ? detail.trim().slice(0, 500) : null,
    zoneId: typeof zoneId === 'string' && zoneId ? zoneId : null,
    zoneName: typeof zoneName === 'string' && zoneName ? zoneName : null,
    storeId: typeof storeId === 'string' && storeId ? storeId : null,
    storeName: resolvedStoreName,
    contactConsent: contactConsent === true,
  });

  res.status(201).json({ success: true, data: suggestion, message: 'Thanks! We have noted your suggestion.' });
});

export const adminGetSuggestions = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { status, buyerType, zoneId, range, from, to } = req.query;
  const suggestions = await ProductSuggestionService.findAll(
    {
      status: (status as SuggestionStatus | 'all') || 'all',
      buyerType: (buyerType as BuyerType | 'all') || 'all',
      zoneId: typeof zoneId === 'string' && zoneId ? zoneId : undefined,
    },
    (range as SuggestionRange) || '30d',
    from as string | undefined,
    to as string | undefined
  );
  res.json({ success: true, data: suggestions });
});

export const adminGetSuggestionInsights = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { range, from, to } = req.query;
  const insights = await ProductSuggestionService.getInsights(
    (range as SuggestionRange) || '30d',
    from as string | undefined,
    to as string | undefined
  );
  res.json({ success: true, data: insights });
});

export const adminUpdateSuggestionStatus = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { status } = req.body;
  const allowed: SuggestionStatus[] = ['new', 'reviewing', 'added', 'declined'];
  if (!allowed.includes(status)) { res.status(400).json({ success: false, error: 'Invalid status' }); return; }
  const updated = await ProductSuggestionService.updateStatus(req.params.id, status);
  if (!updated) { res.status(404).json({ success: false, error: 'Suggestion not found' }); return; }
  res.json({ success: true, data: updated });
});

export const adminUploadPhoto = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ success: false, error: 'No file uploaded' }); return; }

  const bucket = config.supabase.bucket;
  const isProductImage = req.body?.profile === 'product';
  // Callers can ask for a tighter cap: a category icon is painted at ~32px in
  // the app, so storing it at the default 1600px wastes bandwidth on every
  // category view. Clamped so a client can never request an unbounded size.
  const requested = Number(req.body?.maxDimension);
  const maxDimension = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 64), 1600)
    : undefined;
  const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');

  if (isProductImage) {
    const images = await prepareProductImages(req.file.buffer);
    const entries = Object.entries(images) as Array<[keyof PreparedProductImages, PreparedImage]>;
    const assetId = uuidv4();
    const filenames = new Map<PreparedImage, string>();
    for (const [name, variant] of entries) {
      if (!filenames.has(variant)) {
        filenames.set(variant, `products/${assetId}-${baseName || 'product'}-${name}.${variant.extension}`);
      }
    }

    if (config.env !== 'production' && (!config.supabase.url || !config.supabase.serviceRoleKey)) {
      const uploadsDir = path.resolve(__dirname, '../../uploads');
      await mkdir(path.join(uploadsDir, 'products'), { recursive: true });
      await Promise.all([...filenames].map(([variant, variantFilename]) => writeFile(path.join(uploadsDir, variantFilename), variant.buffer)));
      const localUrl = (variant: PreparedImage) => `${req.protocol}://${req.get('host')}/uploads/${filenames.get(variant)!}`;
      const photoVariants = { assetId, thumbnailUrl: localUrl(images.thumbnail), largeUrl: localUrl(images.large) };
      await ProductImageAssetService.createPending({
        id: assetId, uploadedBy: req.admin!.id, thumbnailUrl: photoVariants.thumbnailUrl, largeUrl: photoVariants.largeUrl,
        thumbnailKey: filenames.get(images.thumbnail)!, largeKey: filenames.get(images.large)!, storageDriver: 'local',
      });
      res.json({ success: true, data: { url: photoVariants.largeUrl, ...photoVariants, photoVariants } });
      return;
    }

    const uploaded = await Promise.all([...filenames].map(async ([variant, variantFilename]) => {
      const uploadRes = await fetch(`${config.supabase.url}/storage/v1/object/${bucket}/${variantFilename}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabase.serviceRoleKey}`,
          'Content-Type': variant.mimeType,
          'x-upsert': 'false',
          'cache-control': 'max-age=31536000, immutable',
        },
        body: variant.buffer,
        signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
      });
      if (!uploadRes.ok) {
        await uploadRes.text();
        throw new Error('Upload failed. Please try again.');
      }
      return [variant, `${config.supabase.url}/storage/v1/object/public/${bucket}/${variantFilename}`] as const;
    }));
    const urls = new Map(uploaded);
    const photoVariants = {
      assetId,
      thumbnailUrl: urls.get(images.thumbnail)!,
      largeUrl: urls.get(images.large)!,
    };
    await ProductImageAssetService.createPending({
      id: assetId, uploadedBy: req.admin!.id, thumbnailUrl: photoVariants.thumbnailUrl, largeUrl: photoVariants.largeUrl,
      thumbnailKey: filenames.get(images.thumbnail)!, largeKey: filenames.get(images.large)!, storageDriver: 'supabase',
    });
    res.json({ success: true, data: { url: photoVariants.largeUrl, ...photoVariants, photoVariants } });
    return;
  }

  const image = await prepareImage(req.file.buffer, maxDimension);
  const filename = `${Date.now()}-${baseName || 'image'}.${image.extension}`;

  if (config.env !== 'production' && (!config.supabase.url || !config.supabase.serviceRoleKey)) {
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), image.buffer);
    const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
    res.json({ success: true, data: { url: publicUrl } });
    return;
  }

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
    signal: timeoutSignal(OUTBOUND_TIMEOUTS.storageUpload),
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

/**
 * Stores whose inventory this admin may manage. The hub renders this as a
 * store picker: a zone head sees its own store plus every store tagged into
 * its active zone; every other admin sees only its own.
 */
export const adminGetInventoryStores = asyncHandler(async (req: AdminRequest, res: Response) => {
  const admin = req.admin!;
  if (admin.role === 'super_admin') {
    const stores = await StoreService.findAll();
    res.json({
      success: true,
      data: stores.map(s => ({ id: s.id, name: s.name, address: s.address, isOwn: false })),
    });
    return;
  }
  if (!admin.storeId) { res.json({ success: true, data: [] }); return; }
  const result = await query(
    `SELECT s.id, s.name, s.address, (s.id = $1) as "isOwn"
       FROM mart_stores s
      WHERE s.id = $1
         OR s.id IN (
           SELECT zs.store_id
             FROM mart_zones z
             JOIN mart_zone_stores zs ON zs.zone_id = z.id
            WHERE z.primary_store_id = $1
              AND z.is_active = true
         )
      ORDER BY (s.id = $1) DESC, s.name ASC`,
    [admin.storeId]
  );
  res.json({ success: true, data: result.rows });
});

/** Inventory-relevant settings for the store the caller is managing. */
export const adminGetInventorySettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = await resolveManagedStoreId(req);
  const settings = await SettingsService.getPublic(storeId);
  const threshold = settings.low_stock_threshold;
  res.json({
    success: true,
    data: {
      inventoryTracking: settings.inventory_tracking === 'true',
      autoOutOfStock: (settings.auto_out_of_stock ?? 'on_zero') === 'on_zero',
      lowStockThreshold: threshold != null && threshold !== '' ? Number(threshold) : null,
    },
  });
});

export const adminUpdateInventorySettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  if (!['super_admin', 'store_owner', 'store_manager'].includes(req.admin?.role || '')) {
    res.status(403).json({ success: false, error: 'Only store owners and managers can change inventory policy' }); return;
  }
  const storeId = await resolveManagedStoreId(req);
  const values: Record<string, string> = {};
  if (typeof req.body.inventoryTracking === 'boolean') values.inventory_tracking = String(req.body.inventoryTracking);
  if (typeof req.body.autoOutOfStock === 'boolean') values.auto_out_of_stock = req.body.autoOutOfStock ? 'on_zero' : 'off';
  if (req.body.lowStockThreshold !== undefined) {
    const threshold = Number(req.body.lowStockThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      res.status(400).json({ success: false, error: 'Low-stock threshold must be a non-negative number' }); return;
    }
    values.low_stock_threshold = String(threshold);
  }
  if (!Object.keys(values).length) {
    res.status(400).json({ success: false, error: 'No inventory policy changes provided' }); return;
  }
  await SettingsService.updateMany(storeId, values);
  res.json({ success: true, message: 'Inventory policy updated' });
});

export const adminGetInventory = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = await resolveManagedStoreId(req);
  const data = await InventoryService.getStoreInventory(storeId);
  res.json({ success: true, data });
});

export const adminRestockProduct = asyncHandler(async (req: AdminRequest, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }
  const storeId = await resolveManagedStoreId(req);
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
  const storeId = await resolveManagedStoreId(req);
  const data = await InventoryService.getHistory(req.params.productId, storeId);
  res.json({ success: true, data });
});

export const adminSetProductStock = asyncHandler(async (req: AdminRequest, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) { res.status(400).json({ success: false, error: 'Idempotency-Key is required' }); return; }
  const storeId = await resolveManagedStoreId(req);
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
  const storeId = await resolveManagedStoreId(req);
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

// ── Promotional push controllers ────────────────────────────────────────────

export const adminGetPromotions = asyncHandler(async (_req: AdminRequest, res: Response) => {
  res.json({ success: true, data: await PromotionService.list() });
});

export const adminCreatePromotion = asyncHandler(async (req: AdminRequest, res: Response) => {
  try {
    res.status(201).json({ success: true, data: await PromotionService.create(req.body, req.admin!.id) });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message || 'Promotion could not be created' }); }
});

export const adminUpdatePromotion = asyncHandler(async (req: AdminRequest, res: Response) => {
  try {
    const promotion = await PromotionService.update(req.params.id, req.body);
    if (!promotion) { res.status(404).json({ success: false, error: 'Promotion not found' }); return; }
    res.json({ success: true, data: promotion });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message || 'Promotion could not be updated' }); }
});

export const adminDeletePromotion = asyncHandler(async (req: AdminRequest, res: Response) => {
  try { await PromotionService.delete(req.params.id); res.json({ success: true }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message || 'Promotion could not be deleted' }); }
});

export const adminPreviewPromotion = asyncHandler(async (req: AdminRequest, res: Response) => {
  try { res.json({ success: true, data: await PromotionService.preview(req.params.id) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message || 'Preview failed' }); }
});

export const adminTestPromotion = asyncHandler(async (req: AdminRequest, res: Response) => {
  try { res.json({ success: true, data: await PromotionService.test(req.params.id, req.admin!.id) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message || 'Test send failed' }); }
});

export const adminSendPromotion = asyncHandler(async (req: AdminRequest, res: Response) => {
  try { res.json({ success: true, data: await PromotionService.send(req.params.id) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message || 'Promotion could not be sent' }); }
});

export const redirectPromotionClick = asyncHandler(async (req: Request, res: Response) => {
  const destination = await PromotionService.registerClick(req.params.id);
  if (!destination) { res.status(404).json({ success: false, error: 'Promotion not found' }); return; }
  res.redirect(302, destination);
});

// ── Carousel controllers ──────────────────────────────────────────────────────

export const getCarouselSlides = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const slides = await CampaignService.getCarouselSlides(true, req.customer?.id || null);
  res.json({ success: true, data: slides });
});

export const getCarouselSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await CampaignService.getCarouselSettings();
  res.json({ success: true, data: settings });
});

export const adminGetCarouselSlides = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const slides = await CampaignService.getCarouselSlides(false);
  res.json({ success: true, data: slides });
});

export const adminGetCarouselSettings = asyncHandler(async (_req: AdminRequest, res: Response) => {
  const settings = await CampaignService.getCarouselSettings();
  res.json({ success: true, data: settings });
});

export const adminUpdateCarouselSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
  const settings = await CampaignService.updateCarouselSettings(req.body);
  res.json({ success: true, data: settings });
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

// ── Homepage sections ─────────────────────────────────────────────────────────
// Storefront reads enabled sections only; the store is resolved from the query
// (or Shapoorji by default) exactly like /products and /settings/public.

export const getPublicHomeSections = asyncHandler(async (req: Request, res: Response) => {
  const storeId = (req.query.storeId as string) || SHAPOORJI_ID;
  const sections = await HomeSectionService.publicSections(storeId);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: sections });
});

export const adminGetHomeSections = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const sections = await HomeSectionService.findByStore(storeId, false);
  res.json({ success: true, data: sections });
});

export const adminCreateHomeSection = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const section = await HomeSectionService.create(storeId, req.body);
  res.status(201).json({ success: true, data: section });
});

export const adminUpdateHomeSection = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const section = await HomeSectionService.update(req.params.id, storeId, req.body);
  if (!section) { res.status(404).json({ success: false, error: 'Section not found' }); return; }
  res.json({ success: true, data: section });
});

export const adminDuplicateHomeSection = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const section = await HomeSectionService.duplicate(req.params.id, storeId);
  if (!section) { res.status(404).json({ success: false, error: 'Section not found' }); return; }
  res.status(201).json({ success: true, data: section });
});

export const adminDeleteHomeSection = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  await HomeSectionService.delete(req.params.id, storeId);
  res.json({ success: true, message: 'Section deleted' });
});

export const adminReorderHomeSections = asyncHandler(async (req: AdminRequest, res: Response) => {
  const storeId = resolveStoreId(req);
  const { ids } = req.body;
  if (!Array.isArray(ids)) { res.status(400).json({ success: false, error: 'ids array required' }); return; }
  await HomeSectionService.reorder(storeId, ids);
  res.json({ success: true, message: 'Reordered' });
});

// ── Public campaign routes ────────────────────────────────────────────────────

export const getEligibleCampaigns = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { cartTotal, storeId, zoneId } = req.query;
  const campaigns = await CampaignService.getEligible(
    req.customer?.id || null,
    parseFloat(cartTotal as string) || 0,
    (storeId as string) || '',
    typeof zoneId === 'string' ? zoneId : null,
  );
  res.json({ success: true, data: campaigns });
});

// Public by design: this is the welcome teaser. It returns a whitelisted
// projection (see CampaignService.getPublicWelcomeOffers) and grants no
// authority — an offer can only actually be redeemed after OTP. When a customer
// token is present the teaser is filtered so an offer they already used is not
// advertised back to them.
export const getPublicWelcomeOffers = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { cartTotal, storeId, zoneId } = req.query;
  const offers = await CampaignService.getPublicWelcomeOffers(
    parseFloat(cartTotal as string) || 0,
    (storeId as string) || '',
    req.customer?.id || null,
    typeof zoneId === 'string' ? zoneId : null,
  );
  res.json({ success: true, data: offers });
});

export const validateCouponCode = asyncHandler(async (req: CustomerRequest, res: Response) => {
  const { code, cartTotal, storeId, zoneId } = req.body;
  if (!code) { res.status(400).json({ success: false, error: 'Coupon code required' }); return; }
  try {
    const campaign = await CampaignService.validateCode(
      code, req.customer!.id,
      parseFloat(cartTotal) || 0,
      storeId || '',
      typeof zoneId === 'string' ? zoneId : null,
    );
    const discount = CampaignService.calculateDiscount(campaign, parseFloat(cartTotal) || 0);
    res.json({ success: true, data: { campaign, discount } });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Cart-aware recommendations ────────────────────────────────────────────────
// POST so the cart items are in the body, not a query string.
// Reads free_delivery_above, delivery_charge and min_order_amount from the
// existing Hub settings — never hardcoded.
export const getRecommendations = asyncHandler(async (req: Request, res: Response) => {
  const { storeId, cartItems, cartSubtotal, guestPhone } = req.body;
  const resolvedStoreId = (storeId as string) || SHAPOORJI_ID;
  if (!Array.isArray(cartItems)) {
    res.status(400).json({ success: false, error: 'cartItems array required' }); return;
  }
  const subtotal = parseFloat(cartSubtotal) || 0;
  const customerId = (req as any).customer?.id ?? null;
  // A guest who has typed their phone gets history-based personalisation too.
  // Validated to a 10-digit Indian mobile before use.
  const cleanGuestPhone = normalizeCustomerPhone(guestPhone);
  const resolvedGuestPhone = !customerId && isValidCustomerPhone(cleanGuestPhone)
    ? cleanGuestPhone
    : null;
  const result = await RecommendationService.getRecommendations(
    resolvedStoreId,
    cartItems,
    subtotal,
    customerId,
    resolvedGuestPhone,
  );
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: result });
});
