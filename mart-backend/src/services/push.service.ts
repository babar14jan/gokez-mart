import webpush from 'web-push';
import { query } from '../database/db';
import { config } from '../config';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

export class PushService {

  // Save subscription for a customer
  static async saveCustomerSubscription(customerId: string, sub: {
    endpoint: string; keys: { p256dh: string; auth: string };
  }): Promise<void> {
    await query(
      `INSERT INTO mart_push_subscriptions (customer_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET customer_id = $1, p256dh = $3, auth = $4`,
      [customerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  }

  // Save subscription for an admin
  static async saveAdminSubscription(adminId: string, sub: {
    endpoint: string; keys: { p256dh: string; auth: string };
  }): Promise<void> {
    await query(
      `INSERT INTO mart_push_subscriptions (admin_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET admin_id = $1, p256dh = $3, auth = $4`,
      [adminId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  }

  /**
   * Save a subscription for a guest, keyed on the order tracking token the
   * device already holds. The caller must have validated that the token maps to
   * a real order before calling this — otherwise anyone could register a junk
   * token. Re-registering the same endpoint moves it off any prior owner
   * (member, admin or a different guest token) so one device has exactly one
   * subscription row.
   */
  static async saveGuestSubscription(trackingToken: string, sub: {
    endpoint: string; keys: { p256dh: string; auth: string };
  }): Promise<void> {
    await query(
      `INSERT INTO mart_push_subscriptions (tracking_token, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET tracking_token = $1, customer_id = NULL, admin_id = NULL, p256dh = $3, auth = $4`,
      [trackingToken, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  }

  /**
   * Re-point a device's guest subscriptions to a customer id after OTP login.
   * Without this, a device that subscribed as a guest and then logged in would
   * receive both the guest push (matched by tracking token) and the member push
   * (matched by customer id) for the same order.
   */
  static async rekeyGuestSubscriptions(customerId: string, trackingTokens: string[]): Promise<void> {
    if (!trackingTokens.length) return;
    await query(
      `UPDATE mart_push_subscriptions
         SET customer_id = $1, tracking_token = NULL
       WHERE tracking_token = ANY($2)`,
      [customerId, trackingTokens]
    );
  }

  // Send to a specific customer
  static async notifyCustomer(customerId: string, payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM mart_push_subscriptions WHERE customer_id = $1`,
      [customerId]
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  // Send to every device subscribed to a guest tracking token.
  static async notifyGuest(trackingToken: string, payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM mart_push_subscriptions WHERE tracking_token = $1`,
      [trackingToken]
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  /**
   * Notify whoever placed an order, whether member or guest. Members are matched
   * by customer id; guests by the order's tracking token. Guests previously
   * received nothing, so every order-update call site should use this instead of
   * notifyCustomer directly. Silent no-op if the order has no owner or no
   * subscription — push must never break the order flow.
   */
  static async notifyOrderRecipient(orderId: string, payload: PushPayload): Promise<void> {
    const result = await query<{ customer_id: string | null; tracking_token: string | null }>(
      `SELECT customer_id, tracking_token FROM mart_orders WHERE id = $1`,
      [orderId]
    );
    const row = result.rows[0];
    if (!row) return;
    if (row.customer_id) {
      await this.notifyCustomer(row.customer_id, payload);
    } else if (row.tracking_token) {
      await this.notifyGuest(row.tracking_token, payload);
    }
  }

  static async notifyAdmin(adminId: string, payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM mart_push_subscriptions WHERE admin_id = $1`,
      [adminId]
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  // Send to all admins of a store
  static async notifyStoreAdmins(storeId: string, payload: PushPayload, roles?: string[]): Promise<void> {
    const roleFilter = roles && roles.length > 0
      ? `AND a.role IN (${roles.map((_, i) => `$${i + 2}`).join(',')})`
      : '';
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM mart_push_subscriptions ps
       JOIN mart_admins a ON a.id = ps.admin_id
       WHERE (a.store_id = $1 OR a.role = 'super_admin') ${roleFilter}`,
      roles && roles.length > 0 ? [storeId, ...roles] : [storeId]
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  // Send to all super_admins
  static async notifySuperAdmins(payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM mart_push_subscriptions ps
       JOIN mart_admins a ON a.id = ps.admin_id
       WHERE a.role = 'super_admin'`
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  private static async sendToSubscriptions(
    subs: { endpoint: string; p256dh: string; auth: string }[],
    payload: PushPayload
  ): Promise<void> {
    if (!config.vapid.publicKey) return; // VAPID not configured
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          {
            // Short TTL + high urgency: an order alert that cannot be delivered
            // within ~2 minutes is stale (the delivery meet time is gone), so
            // the push service should drop it instead of delivering it late.
            TTL: 120,
            urgency: 'high',
          }
        ).catch(async (err: any) => {
          // Remove expired or invalid subscriptions
          if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 400) {
            await query(`DELETE FROM mart_push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
          }
        })
      )
    );
    // Silent — push failures never break the main flow
    results.forEach(r => { if (r.status === 'rejected') console.warn('[Push] Failed:', r.reason?.message); });
  }
}
