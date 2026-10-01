import { query, transaction } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { SettingsService } from './settings.service';
import { InventoryService } from './inventory.service';
import { evaluateStoreOpen, formatIstDateTime } from '../utils/storeHours';
import { FunnelCartService } from './funnelCart.service';

export interface OrderItem {
  productId: string;
  productName: string;
  unit: string;
  price: number;
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
  deliveryPreference?: 'within_15' | 'within_30' | 'within_60';
  deliveryNote?: string;
  items: OrderItem[];
  paymentMethod: 'cod' | 'upi' | 'phonepay';
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
              o.total::float, o.payment_method as "paymentMethod",
              o.status, o.notes, o.created_at as "createdAt", o.updated_at as "updatedAt",
              o.delivery_latitude::float as "deliveryLatitude", o.delivery_longitude::float as "deliveryLongitude",
              o.termination_reason as "terminationReason",
              o.cancellation_reason as "cancellationReason",
              o.campaign_id as "campaignId",
              o.campaign_discount::float as "campaignDiscount",
              o.coupon_code_used as "couponCodeUsed",
              o.delivery_by_name as "deliveryByName",
              o.delivery_by_phone as "deliveryByPhone",
              o.delivery_by as "deliveryById",
              o.delivery_preference as "deliveryPreference",
              o.delivery_note as "deliveryNote",
              o.delivery_sequence as "deliverySequence",
              o.batch_id as "batchId",
              o.fulfilled_by as "fulfilledBy",
              -- Closure fields: staff need to know an order was taken after
              -- hours so it is held for the next opening rather than treated as
              -- a late order, and so a manual closure is not mistaken for a
              -- mistimed one.
              o.placed_outside_hours as "placedOutsideHours",
              o.closed_reason as "closedReason",
              o.scheduled_for as "scheduledFor",
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
                'unit', oi.unit,
                'price', oi.price::float,
                'quantity', oi.quantity,
                'total', oi.total::float,
                'photoUrl', p.photo_url
              )) as items`;

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
      throw new Error('Select either an offer or a coupon code, not both');
    }
    const settings = await SettingsService.getPublic(data.storeId);
    const deliveryCharge = parseFloat(settings.delivery_charge || '15');
    const freeAbove = parseFloat(settings.free_delivery_above || '150');

    // Normalize phone once so leads, orders, and funnels all match
    const cleanPhone = data.guestPhone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) throw new Error('Invalid phone number');

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
         VALUES (gen_random_uuid(), $1, $2, $3, 0, 0)
         ON CONFLICT (phone) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, mart_customers.name),
           address = COALESCE(EXCLUDED.address, mart_customers.address),
           updated_at = NOW()`,
        [cleanPhone, data.guestName, data.guestAddress]
      );

      const customerResult = await client.query(
        `SELECT id FROM mart_customers WHERE phone = $1`, [cleanPhone]
      );
      const customerId = customerResult.rows[0]?.id || null;
      if ((data.campaignId || data.couponCodeUsed) && data.customerId !== customerId) {
        throw new Error('Sign in with the ordering phone number to redeem an offer');
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
      for (const item of data.items) {
        if (productIds.has(item.productId)) throw new Error('Each product can only be included once per order');
        productIds.add(item.productId);
        const product = await client.query(
          `SELECT p.name, sp.price::float AS price, sp.unit
           FROM mart_store_products sp
           JOIN mart_products p ON p.id = sp.product_id
           WHERE sp.store_id = $1 AND sp.product_id = $2
             AND sp.is_available = true AND sp.availability_status = 'available'
           FOR SHARE`,
          [data.storeId, item.productId]
        );
        const catalogItem = product.rows[0] as { name: string; price: number; unit: string } | undefined;
        if (!catalogItem || catalogItem.unit !== item.unit) {
          throw new Error('One or more products are unavailable or have changed');
        }
        resolvedItems.push({
          productId: item.productId,
          productName: catalogItem.name,
          unit: catalogItem.unit,
          price: catalogItem.price,
          quantity: item.quantity,
        });
      }
      const subtotal = resolvedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

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
        if (!campaign) throw new Error('Campaign is no longer eligible for this order');
        // A raised minimum order must not strand a customer who was already
        // part-way to the discount, so the previous threshold stays valid for
        // the 6-hour grace window (see migration 053).
        const minOrderMet = subtotal >= Number(campaign.min_order_amount) ||
          (!!campaign.min_order_previous &&
            !!campaign.min_order_grace_until &&
            new Date(campaign.min_order_grace_until) > now &&
            subtotal >= Number(campaign.min_order_previous));
        if (!['active', 'scheduled'].includes(campaign.status) ||
          (campaign.status === 'scheduled' && (!campaign.valid_from || new Date(campaign.valid_from) > now)) ||
            (campaign.store_id && campaign.store_id !== data.storeId) ||
            (campaign.valid_from && new Date(campaign.valid_from) > now) ||
            (campaign.valid_until && new Date(campaign.valid_until) < now) ||
            (campaign.usage_limit && campaign.usage_count >= campaign.usage_limit) ||
            !minOrderMet) {
          throw new Error('Campaign is no longer eligible for this order');
        }
        if (data.campaignId && campaign.coupon_code) {
          throw new Error('Enter the coupon code to redeem this campaign');
        }

        const eligibilityType = campaign.eligibility_type || (campaign.new_customers_only ? 'first_order' : 'all');
        if (eligibilityType === 'first_order') {
          const priorOrders = await client.query(
            `SELECT COUNT(*)::int AS count FROM mart_orders
             WHERE guest_phone = $1 AND status NOT IN ('cancelled', 'terminated', 'failed_delivery')`,
            [cleanPhone]
          );
          if (priorOrders.rows[0].count > 0) throw new Error('This offer is only for first-time customers');
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
            throw new Error(`This offer is for customers inactive for ${campaign.inactive_days} days`);
          }
        }
        if (eligibilityType === 'targeted_customers') {
          const target = await client.query(
            `SELECT 1 FROM mart_campaign_targets WHERE campaign_id = $1 AND customer_id = $2`,
            [campaign.id, customerId]
          );
          if (!target.rows[0]) throw new Error('This offer is not available for this customer');
        }
        const useCount = await client.query(
          `SELECT COUNT(*)::int as count FROM mart_campaign_uses
           WHERE campaign_id = $1 AND customer_id = $2 AND reversed_at IS NULL`,
          [campaign.id, customerId]
        );
        if (useCount.rows[0].count >= campaign.per_customer_limit) {
          throw new Error('Campaign use limit reached for this customer');
        }
      }

      const campaignDiscount = campaign
        ? campaign.discount_type === 'flat'
          ? Math.min(Number(campaign.discount_value), subtotal)
          : campaign.discount_type === 'percent'
            ? Math.min((subtotal * Number(campaign.discount_value)) / 100, campaign.max_discount ? Number(campaign.max_discount) : Number.MAX_SAFE_INTEGER)
            : 0
        : 0;
      const actualDelivery = campaign?.discount_type === 'free_delivery' || subtotal >= freeAbove ? 0 : deliveryCharge;
      const total = Math.max(0, subtotal + actualDelivery - campaignDiscount);

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
          WHERE s.id = $1`,
        [data.storeId]
      );
      const closure = closureRows.rows[0];
      const openState = evaluateStoreOpen(
        closure?.opening_hours as never,
        closure?.store_open,
        new Date(),
      );

      // Create order
      const orderId = uuidv4();
      await client.query(
        `INSERT INTO mart_orders
           (id, order_number, store_id, customer_id, guest_name, guest_phone, guest_address, delivery_latitude, delivery_longitude,
            subtotal, delivery_charge, total, payment_method, notes,
            delivery_preference, delivery_note, fulfilled_by,
            campaign_id, campaign_discount, coupon_code_used, idempotency_key,
            placed_outside_hours, closed_reason, scheduled_for, tracking_token)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
[orderId, orderNumber, data.storeId, customerId, data.guestName, cleanPhone,
          data.guestAddress, data.latitude ?? null, data.longitude ?? null, subtotal, actualDelivery, total,
         data.paymentMethod, data.notes || null,
         data.deliveryPreference || 'within_15',
         data.deliveryNote || 'Ring the bell',
         data.storeName || null,
        campaign?.id || null, campaignDiscount, campaign?.coupon_code || null, data.idempotencyKey,
        openState.isOpen ? false : true,
        openState.closedReason,
        // A manual closure has no reopening time to promise, so it stays null
        // rather than carrying a guess the owner never made.
        openState.nextOpenAt,
        trackingToken]
      );

      await client.query(
        `UPDATE mart_customers
         SET order_count = order_count + 1, total_spent = total_spent + $2, updated_at = NOW()
         WHERE id = $1`,
        [customerId, total]
      );

      // Create order items
      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO mart_order_items
             (id, order_id, product_id, product_name, unit, price, quantity, total)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [orderId, item.productId, item.productName, item.unit,
           item.price, item.quantity, item.price * item.quantity]
        );
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
        total,
        whatsappMessage: this.buildWhatsAppMessage({
          orderNumber, guestName: data.guestName,
          guestPhone: data.guestPhone, // display format for WhatsApp
          guestAddress: data.guestAddress,
          items: resolvedItems, subtotal, deliveryCharge: actualDelivery,
          total, paymentMethod: data.paymentMethod,
          storeName: settings.store_name || 'Gokez Mart',
          upiPhone: settings.upi_phone || '',
          upiId: settings.upi_id || '',
        }),
        whatsappNumber: settings.whatsapp_number || '918777376280',
        duplicate: false,
      };
    });
  }

  static buildWhatsAppMessage(data: {
    orderNumber: string; guestName: string; guestPhone: string;
    guestAddress: string; items: OrderItem[]; subtotal: number;
    deliveryCharge: number; total: number; paymentMethod: string;
    storeName: string; upiPhone: string; upiId: string; zoneName?: string;
  }): string {
    const itemLines = data.items
      .map(i => `• ${i.productName} (${i.unit}) × ${i.quantity} — ₹${(i.price * i.quantity).toFixed(0)}`)
      .join('\n');

    const paymentLine = data.paymentMethod === 'cod'
      ? 'Cash on Delivery'
      : data.paymentMethod === 'upi'
      ? `UPI${data.upiId ? ` — ${data.upiId}` : data.upiPhone ? ` — ${data.upiPhone}` : ''}`
      : 'PhonePe QR';

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
      `💳 *Payment:* ${paymentLine}\n` +
      `🕐 *Ordered:* ${timeStr}, ${dateStr}`;
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
        const itemsRes = await query<{ product_id: string; quantity: number; unit: string }>(
          `SELECT product_id, quantity, unit FROM mart_order_items WHERE order_id = $1`,
          [id]
        );
        const settings = await SettingsService.getPublic(order.storeId);
        const autoOutOfStock = (settings.auto_out_of_stock ?? 'on_zero') === 'on_zero';
        const threshold = parseFloat(settings.low_stock_threshold ?? '5');
        await InventoryService.deductForOrder(
          id,
          order.storeId,
          itemsRes.rows.map(r => ({ productId: r.product_id, quantity: r.quantity, sellingUnit: r.unit })),
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
    cancellationReason?: string
  ) {
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
        (status === 'delivered' && ['out_for_delivery', 'picked_up'].includes(existing.status) && isAssignedHandler) ||
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
        const items = await client.query(
          `SELECT product_id, quantity, unit FROM mart_order_items WHERE order_id = $1`, [id]
        );
        await InventoryService.deductForOrder(
          id,
          existing.storeId,
          items.rows.map((item: { product_id: string; quantity: number; unit: string }) => ({
            productId: item.product_id, quantity: item.quantity, sellingUnit: item.unit,
          })),
          (settings.auto_out_of_stock ?? 'on_zero') === 'on_zero',
          parseFloat(settings.low_stock_threshold ?? '5'),
          client
        );
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
      `${ORDER_LIST_PROJECTION}
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
