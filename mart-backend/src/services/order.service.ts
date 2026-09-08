import { query, transaction } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { SettingsService } from './settings.service';

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
  storeId: string;
  zoneName?: string;
  deliveryPreference?: 'within_15' | 'within_30' | 'within_60';
  deliveryNote?: string;
  items: OrderItem[];
  paymentMethod: 'cod' | 'upi' | 'phonepay';
  notes?: string;
}

export class OrderService {
  // Generate sequential order number MART-001, MART-002 etc
  private static generateOrderNumber(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
    const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `MART-${yy}${mm}${dd}-${rand}`;
  }

  static async create(data: CreateOrderDto) {
    const settings = await SettingsService.getPublic(data.storeId);
    const deliveryCharge = parseFloat(settings.delivery_charge || '15');
    const freeAbove = parseFloat(settings.free_delivery_above || '150');

    const subtotal = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const actualDelivery = subtotal >= freeAbove ? 0 : deliveryCharge;
    const total = subtotal + actualDelivery;
    // Retry on order number collision (extremely rare but safe)
    let orderNumber = this.generateOrderNumber();
    const existing = await query(`SELECT 1 FROM mart_orders WHERE order_number = $1`, [orderNumber]);
    if (existing.rows.length > 0) orderNumber = this.generateOrderNumber();

    return transaction(async (client) => {
      // Upsert customer by phone
      await client.query(
        `INSERT INTO mart_customers (id, phone, name, address, order_count, total_spent)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, $4)
         ON CONFLICT (phone) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, mart_customers.name),
           address = COALESCE(EXCLUDED.address, mart_customers.address),
           order_count = mart_customers.order_count + 1,
           total_spent = mart_customers.total_spent + $4,
           updated_at = NOW()`,
        [data.guestPhone, data.guestName, data.guestAddress, total]
      );

      const customerResult = await client.query(
        `SELECT id FROM mart_customers WHERE phone = $1`, [data.guestPhone]
      );
      const customerId = customerResult.rows[0]?.id || null;

      // Create order
      const orderId = uuidv4();
      await client.query(
        `INSERT INTO mart_orders
           (id, order_number, store_id, customer_id, guest_name, guest_phone, guest_address,
            subtotal, delivery_charge, total, payment_method, notes,
            delivery_preference, delivery_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [orderId, orderNumber, data.storeId, customerId, data.guestName, data.guestPhone,
         data.guestAddress, subtotal, actualDelivery, total,
         data.paymentMethod, data.notes || null,
         data.deliveryPreference || 'within_15',
         data.deliveryNote || 'Hand over at door']
      );

      // Create order items
      for (const item of data.items) {
        await client.query(
          `INSERT INTO mart_order_items
             (id, order_id, product_id, product_name, unit, price, quantity, total)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [orderId, item.productId, item.productName, item.unit,
           item.price, item.quantity, item.price * item.quantity]
        );
      }

      // Mark whatsapp_sent = true (frontend opens WhatsApp)
      await client.query(
        `UPDATE mart_orders SET whatsapp_sent = true WHERE id = $1`, [orderId]
      );

      return {
        orderId,
        orderNumber,
        subtotal,
        deliveryCharge: actualDelivery,
        total,
        whatsappMessage: this.buildWhatsAppMessage({
          orderNumber, guestName: data.guestName,
          guestPhone: data.guestPhone, guestAddress: data.guestAddress,
          items: data.items, subtotal, deliveryCharge: actualDelivery,
          total, paymentMethod: data.paymentMethod,
          storeName: settings.store_name || 'Gokez Mart',
          upiPhone: settings.upi_phone || '',
          upiId: settings.upi_id || '',
        }),
        whatsappNumber: settings.whatsapp_number || '918777376280',
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
      `SELECT o.id, o.order_number as "orderNumber", o.guest_name as "guestName",
              o.guest_phone as "guestPhone", o.guest_address as "guestAddress",
              o.subtotal::float, o.delivery_charge::float as "deliveryCharge",
              o.total::float, o.payment_method as "paymentMethod",
              o.status, o.notes, o.created_at as "createdAt",
              o.delivery_by_name as "deliveryByName",
              o.delivery_by_phone as "deliveryByPhone",
              o.delivery_preference as "deliveryPreference",
              o.delivery_note as "deliveryNote",
              o.delivery_sequence as "deliverySequence",
              o.batch_id as "batchId",
              json_agg(json_build_object(
                'productId', oi.product_id,
                'productName', oi.product_name,
                'unit', oi.unit,
                'price', oi.price::float,
                'quantity', oi.quantity,
                'total', oi.total::float,
                'photoUrl', p.photo_url
              )) as items
       FROM mart_orders o
       LEFT JOIN mart_order_items oi ON oi.order_id = o.id
       LEFT JOIN mart_products p ON p.id = oi.product_id
       ${where}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    return result.rows;
  }

  static async updateStatus(id: string, status: string) {
    const result = await query(
      `UPDATE mart_orders SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, order_number as "orderNumber", status`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  static async trackByPhone(phone: string) {
    return this.findAll({ phone, limit: 10 });
  }
}
