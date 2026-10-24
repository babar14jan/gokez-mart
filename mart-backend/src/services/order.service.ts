import { query, transaction } from '../database/db';
import { badRequest, forbidden, notFound, conflict } from '../utils/apiError';
import { v4 as uuidv4 } from 'uuid';
import { SettingsService } from './settings.service';
import { InventoryService } from './inventory.service';
import { evaluateStoreOpen, formatIstDateTime } from '../utils/storeHours';
import { FunnelCartService } from './funnelCart.service';

// Reasons a customer may give for cancelling, chosen from the order screen. The
// keys are what is stored in mart_orders.cancellation_reason; only these values
// are accepted so the field stays a controlled vocabulary the hub can report on.
export const CUSTOMER_CANCEL_REASONS = {
  ordered_by_mistake: 'Ordered by mistake',
  changed_my_mind: 'Changed my mind',
  wrong_address: 'Wrong address or delivery details',
  found_better_price: 'Found a better price elsewhere',
  delivery_too_slow: 'Delivery is taking too long',
  duplicate_order: 'Duplicate order',
  other: 'Other',
} as const;
export type CustomerCancelReason = keyof typeof CUSTOMER_CANCEL_REASONS;

export interface OrderItem {
  productId: string;
  productName: string;
  unit: string;
  price: number;
  /** List price before the item's discount, captured server-side at order time.
   *  Used only to compute and persist the order's item-level savings; never
   *  trusted from the client. */
  mrp?: number;
  quantity: number;
}

export interface CreateOrderDto {
  guestName: string;
  guestPhone: string;
  guestAddress: string;
  guestAddressLabel?: string;
  latitude?: number | null;
  longitude?: number | null;
  storeId: string;
  storeName?: string;
  zoneName?: string;
  deliveryPreference?: 'within_15' | 'within_30' | 'within_60' | 'scheduled';
  deliveryNote?: string;
  /** Customer-chosen delivery window for a scheduled order (ISO instant). */
  scheduledFor?: string | null;
  items: OrderItem[];
  paymentMethod?: 'cod' | 'upi' | 'phonepay' | null;
  notes?: string;
  campaignId?: string | null;
  campaignDiscount?: number;
  couponCodeUsed?: string | null;
  customerId?: string | null;
  /**
   * Anonymous funnel session that produced this order. Only used to close the
   * cart funnel; it grants no authority. Never trusted as an identity.
   */
  funnelSessionId?: string | null;
  idempotencyKey: string;
}

// Shared projection for every order list: the admin hub and the public token
// tracking endpoint must never drift apart. Only the WHERE clause differs.
const ORDER_LIST_PROJECTION = `SELECT o.id, o.order_number as "orderNumber", o.guest_name as "guestName",
              o.guest_phone as "guestPhone", o.guest_address as "guestAddress",
              o.subtotal::float, o.delivery_charge::float as "deliveryCharge",
              o.total::float, o.payment_method as "paymentMethod", o.payment_collected_at as "paymentCollectedAt",
              o.status, o.notes, o.created_at as "createdAt", o.updated_at as "updatedAt",
              o.delivered_at as "deliveredAt",
              o.delivery_latitude::float as "deliveryLatitude", o.delivery_longitude::float as "deliveryLongitude",
              o.termination_reason as "terminationReason",
              o.cancellation_reason as "cancellationReason",
              o.campaign_id as "campaignId",
              o.campaign_discount::float as "campaignDiscount",
              o.coupon_code_used as "couponCodeUsed",
              o.item_savings::float as "itemSavings",
              o.free_delivery_saving::float as "freeDeliverySaving",
              o.delivery_by_name as "deliveryByName",
              o.delivery_by_phone as "deliveryByPhone",
              o.delivery_by as "deliveryById",
              o.delivery_preference as "deliveryPreference",
              o.delivery_note as "deliveryNote",
              o.delivery_sequence as "deliverySequence",
              o.batch_id as "batchId",
              COALESCE((SELECT s.name FROM mart_stores s WHERE s.id = o.store_id), o.fulfilled_by) as "fulfilledBy",
              (SELECT s.name FROM mart_stores s WHERE s.id = o.store_id) as "storeName",
              (SELECT s.address FROM mart_stores s WHERE s.id = o.store_id) as "storeAddress",
              -- Closure fields: staff need to know an order was taken after
              -- hours so it is held for the next opening rather than treated as
              -- a late order, and so a manual closure is not mistaken for a
              -- mistimed one.
              o.placed_outside_hours as "placedOutsideHours",
              o.closed_reason as "closedReason",
              o.scheduled_for as "scheduledFor",
              o.confirmed_next_open as "confirmedNextOpen",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'fromStatus', e.from_status,
                  'toStatus', e.to_status,
                  'actorName', e.actor_name,
                  'createdAt', e.created_at
                ) ORDER BY e.created_at ASC)
                FROM mart_order_status_events e WHERE e.order_id = o.id
              ), '[]') as "statusEvents",
              json_agg(json_build_object(
                'productId', oi.product_id,
                'productName', oi.product_name,
                'localName', p.local_name,
                'unit', oi.unit,
                'price', oi.price::float,
                'quantity', oi.quantity,
                'total', oi.total::float,
                'photoUrl', p.photo_url
              )) as items`;

// Shared IST-window builder for the analytics summaries. Mirrors the windowing
// used by the funnel/lead utilities so KPI cards agree with the rest of the
// backend reports.
function buildOrderWindow(range: string, from?: string, to?: string, storeId?: string | null): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const at = (index: number) => `$${index}`;
  if (range === 'custom' && from && to) {
    clauses.push(`o.created_at >= ((${at(params.length + 1)}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
    params.push(from);
    clauses.push(`o.created_at < (((${at(params.length + 1)}::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
    params.push(to);
  } else if (range === 'today') {
    clauses.push(`o.created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`);
  } else if (range === '7d' || range === '30d') {
    clauses.push(`o.created_at >= ((date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - (${range === '7d' ? 6 : 29}::int * INTERVAL '1 day'))`);
  } else if (range === 'last_month') {
    clauses.push(`o.created_at >= (date_trunc('month', (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 month') AT TIME ZONE 'Asia/Kolkata')`);
    clauses.push(`o.created_at < (date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`);
  }
  if (storeId) {
    clauses.push(`o.store_id = ${at(params.length + 1)}`);
    params.push(storeId);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export class OrderService {
  // Generate sequential order number MART-001, MART-002 etc
  private static generateOrderNumber(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `MRT${yy}${mm}${dd}${rand}`;
  }

  static async create(data: CreateOrderDto) {
    if (data.campaignId && data.couponCodeUsed) {
      throw badRequest('Select either an offer or a coupon code, not both');
    }
    const settings = await SettingsService.getPublic(data.storeId);
    const deliveryCharge = parseFloat(settings.delivery_charge || '0');
    const freeAbove = parseFloat(settings.free_delivery_above || '0');
    const minOrderAmount = parseFloat(settings.min_order_amount || '0');
    const enforceInventoryAvailability = settings.inventory_tracking === 'true'
      && settings.auto_out_of_stock === 'on_zero';

    // Normalize phone once so leads, orders, and funnels all match
    const cleanPhone = data.guestPhone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) throw badRequest('Invalid phone number');

    // The token is a guest's only credential for reading their order without an
    // account, so it must be unguessable and unique per order.
    const trackingToken = uuidv4();

    // Retry on order number collision (extremely rare but safe)
    let orderNumber = this.generateOrderNumber();
    const existing = await query(`SELECT 1 FROM mart_orders WHERE order_number = $1`, [orderNumber]);
    if (existing.rows.length > 0) orderNumber = this.generateOrderNumber();

    return transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [data.idempotencyKey]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`customer-order:${cleanPhone}`]);
      const prior = await client.query(
        `SELECT id, order_number as "orderNumber", subtotal::float, delivery_charge::float as "deliveryCharge",
                campaign_discount::float as "campaignDiscount",
                item_savings::float as "itemSavings", free_delivery_saving::float as "freeDeliverySaving",
                total::float, tracking_token as "trackingToken"
         FROM mart_orders WHERE idempotency_key = $1`,
        [data.idempotencyKey]
      );
      if (prior.rows[0]) {
        // An idempotent retry must hand back the token already stored on the
        // order; minting a second one would silently break the guest's first.
        return {
          ...prior.rows[0],
          orderId: prior.rows[0].id,
          trackingToken: prior.rows[0].trackingToken,
          storeName: data.storeName || 'Gokez Mart',
          duplicate: true,
        };
      }

      // The customer and campaign are resolved within this transaction. The
      // client may name a campaign, but it never supplies the final discount.
      await client.query(
        `INSERT INTO mart_customers (id, phone, name, address, order_count, total_spent)
         VALUES (gen_random_uuid(), $1, NULLIF($2, 'Customer'), $3, 0, 0)
         ON CONFLICT (phone) DO UPDATE SET
           name = COALESCE(mart_customers.name, EXCLUDED.name),
           address = COALESCE(NULLIF(btrim(EXCLUDED.address), ''), mart_customers.address),
           updated_at = NOW()`,
        [cleanPhone, data.guestName, data.guestAddress]
      );

      const customerResult = await client.query(
        `SELECT id FROM mart_customers WHERE phone = $1`, [cleanPhone]
      );
      const customerId = customerResult.rows[0]?.id || null;
      const attributionResult = data.funnelSessionId
        ? await client.query(
          `SELECT s.session_id, s.visitor_id, s.source, s.medium, s.utm_campaign, s.qr_code_id,
                  v.first_source, v.first_medium, v.first_campaign, v.first_qr_code_id,
                  v.last_source, v.last_medium, v.last_campaign, v.last_qr_code_id
           FROM mart_funnel_sessions s
           LEFT JOIN mart_visitor_attribution v ON v.visitor_id = s.visitor_id
           WHERE s.session_id = $1`,
          [data.funnelSessionId]
        )
        : { rows: [] as Array<Record<string, string | null>> };
      const attribution = attributionResult.rows[0];
      if ((data.campaignId || data.couponCodeUsed) && data.customerId !== customerId) {
        throw forbidden('Sign in with the ordering phone number to redeem this offer');
      }

      // A guest's address lands in the same address book a logged-in customer
      // uses, keyed to the same customer row (the phone-derived one above). When
      // that phone later verifies an OTP, listAddresses serves this row back, so
      // a guest returning as a logged-in shopper finds their address instead of
      // retyping it. Default is claimed only if it is the very first address on
      // the account; identical addresses are not duplicated.
      if (customerId && data.guestAddress?.trim()) {
        await client.query(
          `INSERT INTO mart_customer_addresses (customer_id, label, address_line, latitude, longitude, is_default)
           SELECT $1, $2, $3, $4, $5,
                  NOT EXISTS (SELECT 1 FROM mart_customer_addresses WHERE customer_id = $1)
           WHERE NOT EXISTS (
             SELECT 1 FROM mart_customer_addresses
             WHERE customer_id = $1 AND lower(trim(address_line)) = lower(trim($3))
           )`,
          [customerId, data.guestAddressLabel || 'Home', data.guestAddress.trim(), data.latitude ?? null, data.longitude ?? null]
        );
      }

      // Capture the shopper in the lead funnel. A guest who never touched the
      // OTP flow has no mart_customer_leads row, so their order would be
      // invisible there even though LEAD_BASE already matches orders by
      // guest_phone. Seed the lead with otp_request_count = 0 so the admin table
      // never mistakes a checkout for an OTP request, and set the windowing
      // timestamps (NOT NULL, filtered on by the funnel) to the checkout moment
      // so the guest lands on their own day.
      if (customerId && cleanPhone) {
        await client.query(
          `INSERT INTO mart_customer_leads (phone, customer_id, otp_request_count, first_otp_requested_at, last_otp_requested_at)
           VALUES ($1, $2, 0, NOW(), NOW())
           ON CONFLICT (phone) DO UPDATE SET
             customer_id = COALESCE(mart_customer_leads.customer_id, EXCLUDED.customer_id),
             updated_at = NOW()`,
          [cleanPhone, customerId]
        );
      }

      const productIds = new Set<string>();
      const resolvedItems: OrderItem[] = [];
      const bundleComponentsByProduct = new Map<string, Array<{
        productId: string; name: string; unit: string; quantity: number;
      }>>();
      for (const item of data.items) {
        if (productIds.has(item.productId)) throw badRequest('Each product can only be included once per order');
        productIds.add(item.productId);
        const product = await client.query(
            `SELECT p.name, p.is_bundle as "isBundle", sp.price::float AS price,
              sp.discount_percent::float AS "discountPercent", sp.unit,
              sp.is_available as "isAvailable", sp.availability_status as "availabilityStatus"
           FROM mart_store_products sp
           JOIN mart_products p ON p.id = sp.product_id
           WHERE sp.store_id = $1 AND sp.product_id = $2
           FOR SHARE`,
          [data.storeId, item.productId]
        );
        const catalogItem = product.rows[0] as {
          name: string; isBundle: boolean; price: number; discountPercent: number; unit: string;
          isAvailable: boolean; availabilityStatus: string;
        } | undefined;
        if (!catalogItem || catalogItem.unit !== item.unit || (enforceInventoryAvailability
          && (!catalogItem.isAvailable || catalogItem.availabilityStatus !== 'available'))) {
          throw badRequest('One or more products are unavailable or have changed');
        }
        const effectivePrice = catalogItem.discountPercent > 0
          ? Math.round(catalogItem.price * (1 - catalogItem.discountPercent / 100))
          : catalogItem.price;
        if (catalogItem.isBundle) {
          const components = await client.query(
            `SELECT bc.component_product_id as "productId", p.name,
                    COALESCE(bc.deduction_unit, sp.unit) as unit, bc.quantity::float as quantity,
                    sp.is_available as "isAvailable", sp.availability_status as "availabilityStatus"
             FROM mart_bundle_components bc
             JOIN mart_store_products sp
               ON sp.store_id = bc.store_id AND sp.product_id = bc.component_product_id
             JOIN mart_products p ON p.id = bc.component_product_id
             WHERE bc.store_id = $1 AND bc.bundle_product_id = $2
             FOR SHARE`,
            [data.storeId, item.productId]
          );
          if (components.rows.length < 2) throw badRequest('This combo is no longer available');
          const componentRows = components.rows as Array<{
            productId: string; name: string; unit: string; quantity: number;
            isAvailable: boolean; availabilityStatus: string;
          }>;
          if (enforceInventoryAvailability && componentRows.some(component =>
            !component.isAvailable || component.availabilityStatus !== 'available'
          )) throw badRequest('This combo is no longer available');
          bundleComponentsByProduct.set(item.productId, componentRows);
        }
        resolvedItems.push({
          productId: item.productId,
          productName: catalogItem.name,
          unit: catalogItem.unit,
          price: effectivePrice,
          mrp: catalogItem.price,
          quantity: item.quantity,
        });
      }
      const subtotal = resolvedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      // Item-level discount = list price minus the effective price the customer
      // paid, summed across lines. Only counts lines where the list price is
      // genuinely higher, so an undiscounted item contributes zero.
      const itemSavings = resolvedItems.reduce(
        (sum, item) => sum + Math.max(0, (item.mrp ?? item.price) - item.price) * item.quantity,
        0
      );

      // The store's minimum order (set by the store admin in Settings) is
      // enforced here so it cannot be bypassed with a direct API call. The
      // storefront has its own guard, but that copy is advisory. Compared to
      // the pre-discount item subtotal, which is what the storefront shows.
      if (minOrderAmount > 0 && subtotal < minOrderAmount) {
        throw badRequest(`Minimum order amount is ₹${minOrderAmount}. Add ₹${Math.ceil(minOrderAmount - subtotal)} more to place this order.`);
      }

      let campaign: any = null;
      if (data.campaignId || data.couponCodeUsed) {
        const campaignResult = await client.query(
          data.campaignId
            ? `SELECT * FROM mart_campaigns WHERE id = $1 FOR UPDATE`
            : `SELECT * FROM mart_campaigns WHERE coupon_code = $1 FOR UPDATE`,
          [data.campaignId || data.couponCodeUsed!.trim().toUpperCase()]
        );
        campaign = campaignResult.rows[0];
        const now = new Date();
        if (!campaign) throw badRequest('Campaign is no longer eligible for this order');
        const minOrderMet = subtotal >= Number(campaign.min_order_amount);
        if (!['active', 'scheduled'].includes(campaign.status) ||
          (campaign.status === 'scheduled' && (!campaign.valid_from || new Date(campaign.valid_from) > now)) ||
            (campaign.store_id && campaign.store_id !== data.storeId) ||
            (campaign.valid_from && new Date(campaign.valid_from) > now) ||
            (campaign.valid_until && new Date(campaign.valid_until) < now) ||
            (campaign.usage_limit && campaign.usage_count >= campaign.usage_limit) ||
            !minOrderMet) {
          throw badRequest('Campaign is no longer eligible for this order');
        }
        if (data.campaignId && campaign.coupon_code) {
          throw badRequest('Enter the coupon code to redeem this campaign');
        }

        const eligibilityType = campaign.eligibility_type || (campaign.new_customers_only ? 'first_order' : 'all');
        if (eligibilityType === 'first_order') {
          const priorOrders = await client.query(
            `SELECT COUNT(*)::int AS count FROM mart_orders
             WHERE guest_phone = $1 AND status NOT IN ('cancelled', 'terminated', 'failed_delivery')`,
            [cleanPhone]
          );
          if (!campaign.allow_redemption_until_used && priorOrders.rows[0].count > 0) {
            throw forbidden('This offer is only for first-time customers');
          }
        }
        if (eligibilityType === 'inactive_customers') {
          const priorDelivery = await client.query(
            `SELECT MAX(updated_at) AS last_order_at FROM mart_orders
             WHERE customer_id = $1 AND status = 'delivered'`,
            [customerId]
          );
          const lastOrderAt = priorDelivery.rows[0]?.last_order_at;
          const cutoff = new Date(now.getTime() - Number(campaign.inactive_days) * 24 * 60 * 60 * 1000);
          if (!lastOrderAt || new Date(lastOrderAt) > cutoff) {
            throw badRequest(`This offer is for customers inactive for ${campaign.inactive_days} days`);
          }
        }
        if (eligibilityType === 'targeted_customers') {
          const target = await client.query(
            `SELECT 1 FROM mart_campaign_targets WHERE campaign_id = $1 AND customer_id = $2`,
            [campaign.id, customerId]
          );
          if (!target.rows[0]) throw badRequest('This offer is not available for this customer');
        }
        const useCount = await client.query(
          `SELECT COUNT(*)::int as count FROM mart_campaign_uses
           WHERE campaign_id = $1 AND customer_id = $2 AND reversed_at IS NULL`,
          [campaign.id, customerId]
        );
        if (useCount.rows[0].count >= campaign.per_customer_limit) {
          throw badRequest('Campaign use limit reached for this customer');
        }
      }

      const campaignDiscount = campaign
        ? campaign.discount_type === 'flat'
          ? Math.min(Number(campaign.discount_value), subtotal)
          : campaign.discount_type === 'percent'
            ? Math.min((subtotal * Number(campaign.discount_value)) / 100, campaign.max_discount ? Number(campaign.max_discount) : Number.MAX_SAFE_INTEGER)
            : 0
        : 0;
      // freeAbove = 0 means the store has no free-delivery threshold, so the
      // delivery charge still applies. Without this guard `subtotal >= 0` would
      // waive delivery for every order.
      const actualDelivery = campaign?.discount_type === 'free_delivery' || (freeAbove > 0 && subtotal >= freeAbove) ? 0 : deliveryCharge;
      const total = Math.max(0, subtotal + actualDelivery - campaignDiscount);
      // Delivery fee the customer avoided (either through the free-delivery
      // threshold or a free-delivery offer). Stored so the receipt can show the
      // full "you saved" figure without needing the store's live settings.
      const freeDeliverySaving = actualDelivery === 0 && deliveryCharge > 0 ? deliveryCharge : 0;

      // Whether the store is trading is decided here, on the server, inside the
      // same transaction as the insert. The storefront already shows the customer
      // a closed-store notice, but that copy is advisory: a client-supplied flag
      // would be forgeable, and a device with the wrong clock or timezone would
      // disagree with the schedule. The order record is the accountable copy.
      //
      // A closed store never blocks checkout. Both store columns and the setting
      // are read together because store_open is a manual override that wins over
      // the posted hours, and the two produce different reasons.
      const closureRows = await client.query(
        `SELECT s.opening_hours, sv.value AS store_open
           FROM mart_stores s
           LEFT JOIN mart_settings sv ON sv.store_id = s.id AND sv.key = 'store_open'
           LEFT JOIN mart_settings cf ON cf.store_id = s.id AND cf.key = 'store_closed_from'
           LEFT JOIN mart_settings cu ON cu.store_id = s.id AND cu.key = 'store_closed_until'
          WHERE s.id = $1`,
        [data.storeId]
      );
      const closure = closureRows.rows[0];
      const openState = evaluateStoreOpen(
        closure?.opening_hours as never,
        closure?.store_open,
        new Date(),
        { from: closure?.store_closed_from, until: closure?.store_closed_until },
      );

      // A customer can book a later delivery window ("scheduled"). When they do,
      // their explicit choice is what the order promises; the store-closed
      // fallback only applies when no schedule was requested (or it is malformed).
      const requestedSchedule = data.scheduledFor ? new Date(data.scheduledFor) : null;
      const scheduledFor = requestedSchedule && !Number.isNaN(requestedSchedule.getTime())
        ? requestedSchedule
        : openState.nextOpenAt;

      // Create order
      const orderId = uuidv4();
      await client.query(
        `INSERT INTO mart_orders
           (id, order_number, store_id, customer_id, guest_name, guest_phone, guest_address, delivery_latitude, delivery_longitude,
            subtotal, delivery_charge, total, payment_method, notes,
            delivery_preference, delivery_note, fulfilled_by,
            campaign_id, campaign_discount, coupon_code_used, idempotency_key,
            item_savings, free_delivery_saving,
            placed_outside_hours, closed_reason, scheduled_for, tracking_token,
            funnel_session_id, funnel_visitor_id, attribution_source, attribution_medium, attribution_campaign, attribution_qr_code_id,
            first_touch_source, first_touch_medium, first_touch_campaign, first_touch_qr_code_id,
            last_touch_source, last_touch_medium, last_touch_campaign, last_touch_qr_code_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)`,
[orderId, orderNumber, data.storeId, customerId, data.guestName, cleanPhone,
          data.guestAddress, data.latitude ?? null, data.longitude ?? null, subtotal, actualDelivery, total,
         data.paymentMethod || null, data.notes || null,
         data.deliveryPreference || 'within_15',
         data.deliveryNote || 'Ring the bell',
         data.storeName || null,
        campaign?.id || null, campaignDiscount, campaign?.coupon_code || null, data.idempotencyKey,
        itemSavings, freeDeliverySaving,
        openState.isOpen ? false : true,
        openState.closedReason,
        // A manual closure has no reopening time to promise, so it stays null
        // rather than carrying a guess the owner never made.
        scheduledFor,
        trackingToken,
        attribution?.session_id ?? null,
        attribution?.visitor_id ?? null,
        attribution?.source ?? null,
        attribution?.medium ?? null,
        attribution?.utm_campaign ?? null,
        attribution?.qr_code_id ?? null,
        attribution?.first_source ?? null,
        attribution?.first_medium ?? null,
        attribution?.first_campaign ?? null,
        attribution?.first_qr_code_id ?? null,
        attribution?.last_source ?? null,
        attribution?.last_medium ?? null,
        attribution?.last_campaign ?? null,
        attribution?.last_qr_code_id ?? null]
      );

      await client.query(
        `UPDATE mart_customers
         SET order_count = order_count + 1, total_spent = total_spent + $2, updated_at = NOW()
         WHERE id = $1`,
        [customerId, total]
      );

      // Create order items
      for (const item of resolvedItems) {
        const orderItemId = uuidv4();
        await client.query(
          `INSERT INTO mart_order_items
             (id, order_id, product_id, product_name, unit, price, quantity, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [orderItemId, orderId, item.productId, item.productName, item.unit,
           item.price, item.quantity, item.price * item.quantity]
        );
        const components = bundleComponentsByProduct.get(item.productId) || [];
        for (const component of components) {
          await client.query(
            `INSERT INTO mart_order_item_bundle_components
               (order_item_id, component_product_id, product_name, unit, quantity_per_bundle)
             VALUES ($1,$2,$3,$4,$5)`,
            [orderItemId, component.productId, component.name, component.unit, component.quantity]
          );
        }
      }

      if (campaign) {
        // Snapshot the terms actually applied, so later edits to the campaign
        // can never rewrite what this customer was granted.
        const termsSnapshot = JSON.stringify({
          discount_type: campaign.discount_type,
          discount_value: campaign.discount_value,
          max_discount: campaign.max_discount,
          min_order_amount: campaign.min_order_amount,
          per_customer_limit: campaign.per_customer_limit,
          usage_limit: campaign.usage_limit,
          coupon_code: campaign.coupon_code || null,
          eligibility_type: campaign.eligibility_type || (campaign.new_customers_only ? 'first_order' : 'all'),
          allow_redemption_until_used: Boolean(campaign.allow_redemption_until_used),
          store_id: campaign.store_id || null,
        });
        await client.query(
          `INSERT INTO mart_campaign_uses (campaign_id, customer_id, order_id, discount_applied, coupon_code_used, terms_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [campaign.id, customerId, orderId, campaignDiscount, campaign.coupon_code || null, termsSnapshot]
        );
        await client.query(`UPDATE mart_campaigns SET usage_count = usage_count + 1 WHERE id = $1`, [campaign.id]);
      }

      // Mark whatsapp_sent = true (frontend opens WhatsApp)
      await client.query(
        `UPDATE mart_orders SET whatsapp_sent = true WHERE id = $1`, [orderId]
      );

      // Close the cart funnel loop. This runs on the transaction's own client so
      // the conversion is atomic with the order: if anything above throws, this
      // rolls back too and the cart stays "abandoned" rather than being recorded
      // as an order that never existed.
      if (data.funnelSessionId) {
        await FunnelCartService.markConverted(data.funnelSessionId, orderId, client);
      }

      return {
        orderId,
        orderNumber,
        trackingToken,
        storeName: data.storeName || 'Gokez Mart',
        subtotal,
        deliveryCharge: actualDelivery,
        campaignDiscount,
        itemSavings,
        freeDeliverySaving,
        total,
        whatsappMessage: this.buildWhatsAppMessage({
          orderNumber, guestName: data.guestName,
          guestPhone: data.guestPhone, // display format for WhatsApp
          guestAddress: data.guestAddress,
          items: resolvedItems, subtotal, deliveryCharge: actualDelivery,
          total, paymentMethod: data.paymentMethod || null,
          storeName: data.storeName || 'Gokez Mart',
          upiPhone: settings.upi_phone || '',
          upiId: settings.upi_id || '',
        }),
        // The store's own WhatsApp number, so the customer can reach the store
        // they ordered from. Empty when the store has not set one — never a
        // number belonging to somebody else.
        whatsappNumber: settings.whatsapp_number || '',
        duplicate: false,
      };
    });
  }

  static buildWhatsAppMessage(data: {
    orderNumber: string; guestName: string; guestPhone: string;
    guestAddress: string; items: OrderItem[]; subtotal: number;
    deliveryCharge: number; total: number; paymentMethod: string | null;
    storeName: string; upiPhone: string; upiId: string; zoneName?: string;
  }): string {
    const itemLines = data.items
      .map(i => `• ${i.productName} (${i.unit}) × ${i.quantity} — ₹${(i.price * i.quantity).toFixed(0)}`)
      .join('\n');

    const paymentLine = 'Payment: collect on delivery';

    const deliveryLine = data.deliveryCharge === 0
      ? 'Delivery: FREE 🎉'
      : `Delivery: ₹${data.deliveryCharge}`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });

    return `🛒 *New Order — ${data.orderNumber}*\n\n` +
      `👤 *${data.guestName}*\n` +
      `📱 ${data.guestPhone}\n` +
      `📍 ${data.guestAddress}\n` +
      (data.zoneName ? `🏘️ *Zone:* ${data.zoneName}\n` : ``) +
      `\n` +
      `*Items:*\n${itemLines}\n\n` +
      `${deliveryLine}\n` +
      `*Total: ₹${data.total.toFixed(0)}*\n\n` +
      `💳 *${paymentLine}*\n` +
      `🕐 *Ordered:* ${timeStr}, ${dateStr}`;
  }

  private static async getInventoryItemsForOrder(orderId: string, client?: any) {
    const db = client || { query };
    const result = await db.query(
      `SELECT product_id as "productId", unit as "sellingUnit", SUM(quantity)::float AS quantity
       FROM (
         SELECT oi.product_id, oi.unit, oi.quantity::numeric AS quantity
         FROM mart_order_items oi
         WHERE oi.order_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM mart_order_item_bundle_components bc WHERE bc.order_item_id = oi.id
           )
         UNION ALL
         SELECT bc.component_product_id AS product_id, bc.unit,
                (oi.quantity * bc.quantity_per_bundle)::numeric AS quantity
         FROM mart_order_items oi
         JOIN mart_order_item_bundle_components bc ON bc.order_item_id = oi.id
         WHERE oi.order_id = $1
       ) inventory_items
       GROUP BY product_id, unit`,
      [orderId]
    );
    return result.rows as Array<{ productId: string; sellingUnit: string; quantity: number }>;
  }

  static async reverseCampaignRedemption(orderId: string, reason: string, client?: any): Promise<void> {
    const reverse = async (db: any) => {
      const reversed = await db.query(
        `UPDATE mart_campaign_uses
         SET reversed_at = NOW(), reversal_reason = $2
         WHERE order_id = $1 AND reversed_at IS NULL
         RETURNING campaign_id`,
        [orderId, reason]
      );
      for (const use of reversed.rows) {
        await db.query(
          `UPDATE mart_campaigns SET usage_count = GREATEST(usage_count - 1, 0), updated_at = NOW() WHERE id = $1`,
          [use.campaign_id]
        );
      }
    };
    if (client) return reverse(client);
    await transaction(reverse);
  }

  // One SQL pass over mart_orders for the hub's KPI cards (Dashboard, Analytics).
  // Every money/count figure is derived live from the order rows in the window —
  // nothing is read from materialised counters (mart_customers.order_count /
  // total_spent) that could drift when an order is cancelled or backfilled.
  static async getSummary(range = 'all', from?: string, to?: string, storeId?: string | null) {
    const { where, params } = buildOrderWindow(range, from, to, storeId);
    const result = await query<{
      placed: number; pending: number; delivered: number; cancelled: number;
      revenue: string | number; delivered_revenue: string | number;
      delivery_collected: string | number;
      free_deliveries: number; coupon_orders: number; coupon_amount: string | number;
    }>(
      `SELECT COUNT(*)::int AS placed,
         COUNT(*) FILTER (WHERE o.status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE o.status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE o.status IN ('cancelled','failed_delivery','terminated'))::int AS cancelled,
         COALESCE(SUM(o.total) FILTER (WHERE o.status NOT IN ('cancelled','failed_delivery','terminated')), 0)::float AS revenue,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0)::float AS delivered_revenue,
         COALESCE(SUM(o.delivery_charge) FILTER (WHERE o.status = 'delivered'), 0)::float AS delivery_collected,
         COUNT(*) FILTER (WHERE o.status = 'delivered' AND o.delivery_charge = 0)::int AS free_deliveries,
         COUNT(*) FILTER (WHERE o.status NOT IN ('cancelled','failed_delivery','terminated') AND (o.coupon_code_used IS NOT NULL OR o.campaign_id IS NOT NULL))::int AS coupon_orders,
         COALESCE(SUM(o.campaign_discount) FILTER (WHERE o.status NOT IN ('cancelled','failed_delivery','terminated')), 0)::float AS coupon_amount
       FROM mart_orders o ${where}`,
      params
    );
    const row = result.rows[0];
    // Revenue = value of everything placed in the window that wasn't cancelled,
    // net of offers (o.total is already subtotal + delivery − campaign_discount).
    const revenue = Number(row?.revenue ?? 0);
    const delivered = row?.delivered ?? 0;
    const deliveredRevenue = Number(row?.delivered_revenue ?? 0);
    return {
      placed: row?.placed ?? 0,
      pending: row?.pending ?? 0,
      delivered,
      cancelled: row?.cancelled ?? 0,
      revenue,
      avgOrderValue: delivered ? deliveredRevenue / delivered : 0,
      deliveryCollected: Number(row?.delivery_collected ?? 0),
      freeDeliveries: row?.free_deliveries ?? 0,
      couponOrders: row?.coupon_orders ?? 0,
      couponAmount: Number(row?.coupon_amount ?? 0),
    };
  }

  // Customer card figures for the Analytics Customers tab. Spend remains based
  // on delivered orders, while a customer becomes returning as soon as they
  // place a later non-terminal order after a delivery under the same mobile.
  static async getCustomerAggregates(range = 'all', from?: string, to?: string, storeId?: string | null, topCount = 10) {
    const { where, params } = buildOrderWindow(range, from, to, storeId);
    const phoneIdentity = `NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '')`;
    const storeScope = storeId ? `AND o.store_id = $${params.length}` : '';
    const aggSql = `SELECT
         ${phoneIdentity} AS ckey,
         MAX(COALESCE(cu.name, o.guest_name)) AS name,
         MAX(COALESCE(cu.phone, o.guest_phone)) AS phone,
         COUNT(*)::int AS order_count,
         SUM(o.total)::float AS total_spent
       FROM mart_orders o
       LEFT JOIN mart_customers cu ON cu.id = o.customer_id
       WHERE o.status = 'delivered'
         AND ${phoneIdentity} IS NOT NULL${where ? ` AND ${where.replace(/^WHERE\s+/, '')}` : ''}
       GROUP BY 1`;
    const lifecycleSql = `WITH delivered_agg AS (${aggSql}), scoped_orders AS (
         SELECT ${phoneIdentity} AS phone, o.created_at
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
         WHERE o.status NOT IN ('cancelled', 'failed_delivery', 'terminated')
           AND ${phoneIdentity} IS NOT NULL${where ? ` AND ${where.replace(/^WHERE\s+/, '')}` : ''}
       ), first_deliveries AS (
         SELECT ${phoneIdentity} AS phone, MIN(o.delivered_at) AS first_delivered_at
         FROM mart_orders o
         LEFT JOIN mart_customers cu ON cu.id = o.customer_id
         WHERE o.status = 'delivered'
           AND ${phoneIdentity} IS NOT NULL ${storeScope}
         GROUP BY 1
       ), active_customers AS (
         SELECT s.phone, BOOL_OR(s.created_at > f.first_delivered_at) AS is_returning
         FROM scoped_orders s
         JOIN first_deliveries f ON f.phone = s.phone
         GROUP BY s.phone
       )
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE NOT is_returning)::int AS new_customers,
        COUNT(*) FILTER (WHERE is_returning)::int AS repeat_customers,
        COALESCE((SELECT SUM(order_count) FROM delivered_agg), 0)::int AS delivered_orders
       FROM active_customers`;
    const [totals, top] = await Promise.all([
          query<{ total: number; new_customers: number; repeat_customers: number; delivered_orders: number }>(
        lifecycleSql,
        params
      ),
      query<{ ckey: string; name: string | null; phone: string | null; order_count: number; total_spent: string | number }>(
        `WITH agg AS (${aggSql})
         SELECT ckey, name, phone, order_count, total_spent
         FROM agg
         ORDER BY total_spent DESC, order_count DESC
         LIMIT $${params.length + 1}`,
        [...params, topCount]
      ),
    ]);
    const t = totals.rows[0];
    const total = t?.total ?? 0;
    return {
      totalCustomers: total,
      newCustomers: t?.new_customers ?? 0,
      repeatCustomers: t?.repeat_customers ?? 0,
      avgOrders: total ? Number(t?.delivered_orders ?? 0) / total : 0,
      top: top.rows.map(r => ({
        id: r.ckey,
        name: r.name || '',
        phone: r.phone || '',
        orderCount: r.order_count,
        totalSpent: Number(r.total_spent ?? 0),
      })),
    };
  }

  static async findAll(filters?: { storeId?: string; status?: string; phone?: string; limit?: number; offset?: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters?.storeId) { conditions.push(`o.store_id = $${i++}`); params.push(filters.storeId); }
    if (filters?.status)  { conditions.push(`o.status = $${i++}`);   params.push(filters.status); }
    if (filters?.phone)   { conditions.push(`o.guest_phone = $${i++}`); params.push(filters.phone); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const result = await query(
      `${ORDER_LIST_PROJECTION}
       FROM mart_orders o
       LEFT JOIN mart_order_items oi ON oi.order_id = o.id
       LEFT JOIN mart_products p ON p.id = oi.product_id
       ${where}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    // Labelled here rather than in the hub so every order timestamp is rendered
    // by the same IST formatter. The hub's own date helpers omit the timezone and
    // would show these in the browser's zone.
    return result.rows.map(row => ({ ...row, scheduledForLabel: formatIstDateTime(row.scheduledFor) }));
  }

  static async updateStatus(id: string, status: string) {
    const result = await query(
      `UPDATE mart_orders SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, order_number as "orderNumber", status, store_id as "storeId"`,
      [status, id]
    );
    const order = result.rows[0] || null;

    // Deduct inventory when order is delivered
    if (order && status === 'delivered') {
      try {
        const items = await this.getInventoryItemsForOrder(id);
        const settings = await SettingsService.getPublic(order.storeId);
        if (settings.inventory_tracking !== 'true') return order;
        const autoOutOfStock = (settings.auto_out_of_stock ?? 'on_zero') === 'on_zero';
        const threshold = parseFloat(settings.low_stock_threshold ?? '5');
        await InventoryService.deductForOrder(
          id,
          order.storeId,
          items,
          autoOutOfStock,
          threshold
        );
      } catch { /* non-blocking — don't fail order status update */ }
    }

    return order;
  }

  static async transitionStatus(
    id: string,
    status: string,
    actor: { id: string; username: string; role: string; storeId: string | null },
    deliveryAssigneeId?: string,
    cancellationReason?: string,
    paymentMethod?: 'cash' | 'upi'
  ) {
    if (status === 'delivered' && !['cash', 'upi'].includes(paymentMethod || '')) {
      throw badRequest('Record Cash or UPI payment before marking this order delivered');
    }
    const order = await transaction(async client => {
      const current = await client.query(
        `SELECT o.id, o.status, o.store_id as "storeId", o.customer_id as "customerId",
                o.order_number as "orderNumber", o.delivery_by as "deliveryById"
         FROM mart_orders o WHERE o.id = $1 FOR UPDATE`,
        [id]
      );
      const existing = current.rows[0];
      if (!existing) throw Object.assign(new Error('Order not found'), { status: 404 });
      const settings = await SettingsService.getPublic(existing.storeId);
      if (actor.role !== 'super_admin' && actor.storeId !== existing.storeId) {
        throw Object.assign(new Error('Access denied'), { status: 403 });
      }
      const actorResult = await client.query(
        `SELECT COALESCE(name, username) as name FROM mart_admins WHERE id = $1`, [actor.id]
      );
      const actorName = actorResult.rows[0]?.name || actor.username;

      const processingRoles = ['super_admin', 'store_owner', 'store_manager', 'staff'];
      const assignmentRoles = ['super_admin', 'store_owner', 'store_manager'];
      const outsideAreaRoles = ['super_admin', 'store_owner', 'store_manager'];
      const isAssignedHandler = existing.deliveryById === actor.id;
      const canCancelOutsideArea = cancellationReason !== 'outside_area' ||
        (status === 'cancelled' && existing.status === 'pending' && outsideAreaRoles.includes(actor.role));
      const allowed =
        (status === 'confirmed' && existing.status === 'pending' && processingRoles.includes(actor.role)) ||
        (status === 'preparing' && existing.status === 'confirmed' && processingRoles.includes(actor.role)) ||
        (status === 'ready_to_pickup' && existing.status === 'preparing' && assignmentRoles.includes(actor.role) && !!deliveryAssigneeId) ||
        (status === 'out_for_delivery' && ['ready_to_pickup', 'picked_up'].includes(existing.status) && isAssignedHandler) ||
        (status === 'delivered' && ['out_for_delivery', 'picked_up'].includes(existing.status) && (isAssignedHandler || assignmentRoles.includes(actor.role))) ||
        (status === 'cancelled' && ['pending', 'confirmed'].includes(existing.status) && processingRoles.includes(actor.role) && canCancelOutsideArea) ||
        (status === 'failed_delivery' && ['out_for_delivery', 'picked_up'].includes(existing.status) && (isAssignedHandler || assignmentRoles.includes(actor.role)));

      if (!allowed) throw Object.assign(new Error('This status change is not allowed'), { status: 403 });

      let handler: { id: string; name: string; phone: string | null } | null = null;
      if (status === 'ready_to_pickup') {
        const assignee = await client.query(
          `SELECT a.id, COALESCE(a.name, a.username) as name, a.phone
           FROM mart_admins a
           LEFT JOIN mart_admin_store_assignments asa ON asa.admin_id = a.id AND asa.store_id = $2 AND asa.is_active = true
           WHERE a.id = $1 AND a.is_active = true AND (a.store_id = $2 OR asa.admin_id IS NOT NULL)
             AND a.role IN ('super_admin', 'store_owner', 'store_manager', 'staff', 'delivery_staff')`,
          [deliveryAssigneeId, existing.storeId]
        );
        handler = assignee.rows[0] || null;
        if (!handler) throw Object.assign(new Error('Select an active delivery handler for this store'), { status: 400 });
      }

      const updated = await client.query(
        `UPDATE mart_orders SET status = $1, updated_at = NOW(),
           delivery_by = CASE WHEN $1 = 'ready_to_pickup' THEN $2 ELSE delivery_by END,
           delivery_by_name = CASE WHEN $1 = 'ready_to_pickup' THEN $3 ELSE delivery_by_name END,
           delivery_by_phone = CASE WHEN $1 = 'ready_to_pickup' THEN $4 ELSE delivery_by_phone END
         WHERE id = $5
         RETURNING id, order_number as "orderNumber", status, store_id as "storeId", customer_id as "customerId",
                   delivery_by_name as "deliveryByName"`,
        [status, handler?.id || null, handler?.name || null, handler?.phone || null, id]
      );
      if (status === 'delivered') {
        await client.query(
          `UPDATE mart_orders SET payment_method = $1, payment_collected_at = NOW(), delivered_at = COALESCE(delivered_at, NOW()) WHERE id = $2`,
          [paymentMethod === 'cash' ? 'cod' : 'upi', id]
        );
      }
      if (status === 'delivered') {
        try {
          if (settings.inventory_tracking === 'true') {
            const items = await this.getInventoryItemsForOrder(id, client);
            await InventoryService.deductForOrder(
              id,
              existing.storeId,
              items,
              (settings.auto_out_of_stock ?? 'on_zero') === 'on_zero',
              parseFloat(settings.low_stock_threshold ?? '5'),
              client
            );
          }
        } catch (err) {
          // Never block a delivery over inventory bookkeeping. Loss/unit issues
          // are logged and skipped so the order still marks delivered, matching
          // the non-blocking behavior of updateStatus().
          console.error(`[inventory] deduction skipped for delivered order ${id}:`, err);
        }
      }
      if (['cancelled', 'failed_delivery', 'terminated'].includes(status)) {
        await this.reverseCampaignRedemption(id, status, client);
      }
      await client.query(
        `INSERT INTO mart_order_status_events (order_id, from_status, to_status, actor_id, actor_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, existing.status, status, actor.id, actorName]
      );
      return updated.rows[0];
    });

    return order;
  }

  /**
   * Acknowledge an after-hours order for the next opening hours.
   *
   * Only meaningful for orders placed outside posted hours: the store was shut
   * when the customer ordered, so the hub cannot start preparing anything —
   * instead it promises delivery at the next opening. Reuses the normal
   * pending → confirmed transition (same status event, same analytics counts,
   * same subsequent preparing flow) and additionally records the promise on
   * the order so the customer's card can explain it, the customer gets a push,
   * and the hub can track how many after-hours orders were accepted.
   */
  static async confirmForNextOpen(
    id: string,
    actor: { id: string; username: string; role: string; storeId: string | null }
  ) {
    const order = await transaction(async client => {
      const current = await client.query(
        `SELECT o.id, o.status, o.store_id as "storeId", o.customer_id as "customerId",
                o.order_number as "orderNumber", o.placed_outside_hours as "placedOutsideHours",
                o.scheduled_for as "scheduledFor"
         FROM mart_orders o WHERE o.id = $1 FOR UPDATE`,
        [id]
      );
      const existing = current.rows[0];
      if (!existing) throw Object.assign(new Error('Order not found'), { status: 404 });
      if (actor.role !== 'super_admin' && actor.storeId !== existing.storeId) {
        throw Object.assign(new Error('Access denied'), { status: 403 });
      }
      if (existing.status !== 'pending') {
        throw Object.assign(new Error('Only pending after-hours orders can be confirmed for the next opening'), { status: 409 });
      }
      if (!existing.placedOutsideHours) {
        throw Object.assign(new Error('This order was placed during opening hours'), { status: 409 });
      }
      const actorResult = await client.query(
        `SELECT COALESCE(name, username) as name FROM mart_admins WHERE id = $1`, [actor.id]
      );
      const actorName = actorResult.rows[0]?.name || actor.username;

      // Promise the next opening when the schedule knows one. A manual closure
      // has no reopening time to promise, so it keeps whatever the order
      // recorded (usually null) rather than inventing one.
      const hours = await client.query(
        `SELECT s.opening_hours, sv.value AS store_open,
                cf.value AS store_closed_from, cu.value AS store_closed_until
           FROM mart_stores s
           LEFT JOIN mart_settings sv ON sv.store_id = s.id AND sv.key = 'store_open'
           LEFT JOIN mart_settings cf ON cf.store_id = s.id AND cf.key = 'store_closed_from'
           LEFT JOIN mart_settings cu ON cu.store_id = s.id AND cu.key = 'store_closed_until'
          WHERE s.id = $1`,
        [existing.storeId]
      );
      const closure = hours.rows[0];
      const openState = evaluateStoreOpen(
        closure?.opening_hours as never,
        closure?.store_open,
        new Date(),
        { from: closure?.store_closed_from, until: closure?.store_closed_until },
      );

      await client.query(
        `UPDATE mart_orders
            SET status = 'confirmed',
                confirmed_next_open = true,
                scheduled_for = COALESCE(scheduled_for, $1),
                updated_at = NOW()
          WHERE id = $2`,
        [openState.nextOpenAt, id]
      );
      await client.query(
        `INSERT INTO mart_order_status_events (order_id, from_status, to_status, actor_id, actor_name)
         VALUES ($1, $2, 'confirmed', $3, $4)`,
        [id, 'pending', actor.id, actorName]
      );
      return {
        ...existing,
        status: 'confirmed',
        confirmedNextOpen: true,
        nextOpenAt: openState.nextOpenAt,
        nextOpenLabel: openState.nextOpenLabel,
      };
    });

    return order;
  }

  /**
   * Single cancellation path for both callers: a signed-in customer (matched on
   * customer_id) and a guest (matched on the unguessable tracking token issued
   * at order creation).
   *
   * The credential is folded into the SELECT rather than checked afterwards, so
   * a wrong token returns the same 404 as a missing order. Answering 403 for
   * "exists but not yours" would let a caller probe order ids.
   *
   * Previously this ran inline in the controller: it wrote no status event and
   * no cancellation_reason, so a customer-cancelled order showed up with no
   * explanation in the customer's own order screen.
   */
  static async cancelByCaller(
    orderId: string,
    scope: { customerId: string } | { trackingToken: string },
    reason?: string | null
  ) {
    const isGuest = 'trackingToken' in scope;
    const credential = isGuest ? scope.trackingToken : scope.customerId;
    const matchColumn = isGuest ? 'o.tracking_token' : 'o.customer_id';
    // The customer picks a reason from a fixed list so cancels are explained and
    // accidental cancels require a deliberate choice. Anything unrecognised (a
    // stale client, a crafted body) falls back to the generic label rather than
    // being stored verbatim.
    const cancellationReason = CUSTOMER_CANCEL_REASONS[reason as CustomerCancelReason]
      ? (reason as string)
      : 'customer_request';

    const order = await transaction(async (client) => {
      const current = await client.query(
        `SELECT o.id, o.status, o.order_number as "orderNumber", o.store_id as "storeId",
                o.customer_id as "customerId", o.guest_name as "guestName",
                o.cancellation_reason as "cancellationReason"
         FROM mart_orders o
         WHERE o.id = $1 AND ${matchColumn} = $2
         FOR UPDATE`,
        [orderId, credential]
      );
      const existing = current.rows[0];
      if (!existing) throw Object.assign(new Error('Order not found'), { status: 404 });
      if (!['pending', 'confirmed'].includes(existing.status)) {
        throw Object.assign(new Error('Order cannot be cancelled at this stage'), { status: 400 });
      }

      await client.query(
        `UPDATE mart_orders
            SET status = 'cancelled',
                cancellation_reason = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [orderId, cancellationReason]
      );
      await this.reverseCampaignRedemption(orderId, 'cancelled', client);
      await client.query(
        `INSERT INTO mart_order_status_events (order_id, from_status, to_status, actor_name)
         VALUES ($1, $2, 'cancelled', $3)`,
        [orderId, existing.status, isGuest ? 'Customer (guest)' : 'Customer']
      );
      return existing;
    });

    return order;
  }

  static async trackByPhone(phone: string) {
    return this.findAll({ phone, limit: 10 });
  }

  /**
   * Public order lookup for guests who never created an account.
   *
   * The tracking token is an unguessable uuid issued at order creation, so
   * possession of the token is the credential. Invalid shapes are dropped in
   * SQL rather than surfacing as a Postgres cast error.
   */
  static async trackByTokens(tokens: string[]) {
    const clean = [...new Set(tokens.map(t => String(t).trim()).filter(Boolean))].slice(0, 20);
    if (!clean.length) return [];

    const placeholders = clean.map((_, i) => `$${i + 1}`).join(',');
    const result = await query(
      `${ORDER_LIST_PROJECTION},
              -- Returned only here: the caller already proved possession by
              -- supplying this token, and the client needs it to cancel its own
              -- order later. Kept out of the admin projection so the credential
              -- never lands in the staff order list.
              o.tracking_token as "trackingToken"
       FROM mart_orders o
       LEFT JOIN mart_order_items oi ON oi.order_id = o.id
       LEFT JOIN mart_products p ON p.id = oi.product_id
       WHERE o.tracking_token IN (${placeholders})
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      clean
    );
    // Same IST formatting as the admin hub so both surfaces agree on timestamps.
    return result.rows.map(row => ({ ...row, scheduledForLabel: formatIstDateTime(row.scheduledFor) }));
  }
}
